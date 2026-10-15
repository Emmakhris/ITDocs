import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { createGuardrails, generate as generateTotp } from "otplib";
import { Role, VaultAccessLevel, type Prisma, type VaultFolder, type VaultFolderAccess } from "@prisma/client";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, ForbiddenError, NotFoundError } from "../lib/errors";
import { checkbox, optNum, optStr } from "../lib/forms";
import { aad, decrypt, encrypt } from "../crypto/vault";
import type { Ctx } from "../context";

// ───────────────────────────── Access control ─────────────────────────────
// Module level (rbac/permissions): only Admin + Technician can use the vault at all.
// Folder level: unrestricted folders are open to every vault user; restricted folders only to
// admins and explicit role / user grants. Writing additionally needs vault write permission.

export type FolderAccess = "none" | "view" | "edit";
type FolderWithAccess = VaultFolder & { access: VaultFolderAccess[] };

export function folderAccess(ctx: Ctx, f: FolderWithAccess): FolderAccess {
  const role = ctx.user.role;
  if (!can(role, "vault", "read") || f.deletedAt) return "none";
  if (role === "ADMIN") return "edit";
  const writable = can(role, "vault", "write");
  if (!f.restricted) return writable ? "edit" : "view";
  const grants = f.access.filter((g) => g.userId === ctx.user.id || g.role === role);
  if (!grants.length) return "none";
  return grants.some((g) => g.level === "EDIT") && writable ? "edit" : "view";
}

async function loadFolder(id: string) {
  const f = await db.vaultFolder.findFirst({ where: { id, deletedAt: null }, include: { access: true } });
  if (!f) throw new NotFoundError("Folder");
  return f;
}

async function requireFolder(ctx: Ctx, id: string, need: "view" | "edit") {
  assertCan(ctx.user.role, "vault", need === "edit" ? "write" : "read");
  const f = await loadFolder(id);
  const a = folderAccess(ctx, f);
  if (a === "none" || (need === "edit" && a !== "edit")) throw new ForbiddenError();
  return { folder: f, access: a };
}

/** IDs of folders this user can at least view. */
export async function accessibleFolderIds(ctx: Ctx): Promise<string[]> {
  if (!can(ctx.user.role, "vault", "read")) return [];
  const all = await db.vaultFolder.findMany({ where: { deletedAt: null }, include: { access: true } });
  return all.filter((f) => folderAccess(ctx, f) !== "none").map((f) => f.id);
}

async function requireCredential(ctx: Ctx, id: string, need: "view" | "edit") {
  const c = await db.credential.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new NotFoundError("Credential");
  const { folder, access } = await requireFolder(ctx, c.folderId, need);
  return { cred: c, folder, access };
}

// ───────────────────────────── Folders ─────────────────────────────

export const folderInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: optStr(500),
  restricted: checkbox,
});

export async function listFolders(ctx: Ctx) {
  assertCan(ctx.user.role, "vault", "read");
  const rows = await db.vaultFolder.findMany({
    where: { deletedAt: null },
    include: { access: true, _count: { select: { credentials: { where: { deletedAt: null } } } } },
    orderBy: { name: "asc" },
  });
  return rows
    .map((f) => ({ ...f, myAccess: folderAccess(ctx, f), count: f._count.credentials }))
    .filter((f) => f.myAccess !== "none");
}

export async function getFolder(ctx: Ctx, id: string) {
  const { folder, access } = await requireFolder(ctx, id, "view");
  const grants = await db.vaultFolderAccess.findMany({ where: { folderId: id }, include: { user: true } });
  return { ...folder, myAccess: access, grants };
}

export async function saveFolder(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "admin", "write");
  const data = folderInput.parse(input);
  const row = { ...data, description: data.description ?? null };
  return db.$transaction(async (tx) => {
    if (!id) {
      const f = await tx.vaultFolder.create({ data: row });
      await audit(tx, ctx, { action: "create", entityType: "VaultFolder", entityId: f.id, summary: `Created vault folder ${f.name}${f.restricted ? " (restricted)" : ""}`, after: row });
      return f;
    }
    const before = await tx.vaultFolder.findUniqueOrThrow({ where: { id } });
    const after = await tx.vaultFolder.update({ where: { id }, data: row });
    const d = diff(before, after);
    if (d.changed.length)
      await audit(tx, ctx, { action: "update", entityType: "VaultFolder", entityId: id, summary: `Updated vault folder ${after.name}`, before: d.before, after: d.after });
    return after;
  });
}

export const grantInput = z.object({
  role: z.nativeEnum(Role).optional(),
  userId: optStr(40),
  level: z.nativeEnum(VaultAccessLevel).default("VIEW"),
});

export async function addFolderGrant(ctx: Ctx, folderId: string, input: unknown) {
  assertCan(ctx.user.role, "admin", "write");
  const g = grantInput.parse(input);
  if (!!g.role === !!g.userId) throw new AppError("Choose either a role or a user.");
  if (g.role === "READONLY" || g.role === "AUDITOR") throw new AppError("Read-only and Auditor roles cannot access the vault.");
  const folder = await loadFolder(folderId);
  return db.$transaction(async (tx) => {
    let who = g.role as string | undefined;
    if (g.userId) {
      const u = await tx.user.findUniqueOrThrow({ where: { id: g.userId } });
      if (!can(u.role, "vault", "read")) throw new AppError(`${u.displayName} has the ${u.role.toLowerCase()} role, which cannot use the vault.`);
      who = u.displayName;
      await tx.vaultFolderAccess.upsert({
        where: { folderId_userId: { folderId, userId: g.userId } },
        create: { folderId, userId: g.userId, level: g.level },
        update: { level: g.level },
      });
    } else {
      await tx.vaultFolderAccess.upsert({
        where: { folderId_role: { folderId, role: g.role! } },
        create: { folderId, role: g.role, level: g.level },
        update: { level: g.level },
      });
    }
    await audit(tx, ctx, { action: "grant", entityType: "VaultFolder", entityId: folderId, summary: `Granted ${g.level} on vault folder ${folder.name} to ${who}` });
  });
}

export async function removeFolderGrant(ctx: Ctx, grantId: string) {
  assertCan(ctx.user.role, "admin", "write");
  await db.$transaction(async (tx) => {
    const g = await tx.vaultFolderAccess.delete({ where: { id: grantId }, include: { folder: true, user: true } });
    await audit(tx, ctx, {
      action: "revoke",
      entityType: "VaultFolder",
      entityId: g.folderId,
      summary: `Revoked ${g.level} on vault folder ${g.folder.name} from ${g.user?.displayName ?? g.role}`,
    });
  });
}

export async function deleteFolder(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "admin", "write");
  const n = await db.credential.count({ where: { folderId: id, deletedAt: null } });
  if (n) throw new AppError(`Folder still holds ${n} credential(s). Move or delete them first.`);
  await db.$transaction(async (tx) => {
    const f = await tx.vaultFolder.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "delete", entityType: "VaultFolder", entityId: id, summary: `Deleted vault folder ${f.name}` });
  });
}

// ───────────────────────────── Credentials ─────────────────────────────

// Many services (Google, AWS, Microsoft…) issue 80-bit seeds; otplib's default minimum is 128-bit.
// We only generate codes for third-party seeds here, so accept the RFC 4226 minimum of 80 bits.
const TOTP_GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES: 10 });

/** Accept a base32 seed ("JBSW Y3DP…") or a full otpauth:// URI from a QR code. */
export function normaliseTotpSeed(raw: string): string {
  let s = raw.trim();
  if (/^otpauth:\/\//i.test(s)) {
    const secret = new URL(s).searchParams.get("secret");
    if (!secret) throw new AppError("That otpauth:// link has no secret.");
    s = secret;
  }
  s = s.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]{16,128}$/.test(s)) throw new AppError("TOTP seed must be base32 (letters A–Z and digits 2–7), at least 16 characters.");
  return s;
}

export const credentialInput = z.object({
  folderId: z.string().min(1, "Choose a folder"),
  title: z.string().trim().min(1, "Title is required").max(160),
  username: optStr(200),
  url: optStr(2000).refine((u) => !u || /^(https?|ssh|rdp|ftp|sftp|smb):\/\//i.test(u) || !/^[a-z]+:/i.test(u), "Unsupported link type"),
  notes: optStr(10000),
  /** blank on edit = keep current secret */
  password: z.string().max(10000).optional(),
  /** "keep" | "clear" | new seed */
  totpSeed: optStr(500),
  clearTotp: checkbox,
  rotateEveryDays: optNum.refine((n) => n === undefined || (n >= 1 && n <= 3650), "1–3650 days"),
});

const meta = (c: { title: string; username: string | null; url: string | null; folderId: string; rotateEveryDays: number | null }) => ({
  title: c.title,
  username: c.username,
  url: c.url,
  folderId: c.folderId,
  rotateEveryDays: c.rotateEveryDays,
});

const dueFrom = (changed: Date, days?: number | null) => (days ? new Date(changed.getTime() + days * 86_400_000) : null);

export async function createCredential(ctx: Ctx, input: unknown) {
  const d = credentialInput.parse(input);
  await requireFolder(ctx, d.folderId, "edit");
  if (!d.password) throw new AppError("Enter the password / secret.");
  const id = crypto.randomUUID();
  const now = new Date();
  return db.$transaction(async (tx) => {
    const c = await tx.credential.create({
      data: {
        id,
        folderId: d.folderId,
        title: d.title,
        username: d.username ?? null,
        url: d.url ?? null,
        notes: d.notes ?? null,
        secretEnc: encrypt(d.password!, aad.secret(id)),
        totpEnc: d.totpSeed ? encrypt(normaliseTotpSeed(d.totpSeed), aad.totp(id)) : null,
        rotateEveryDays: d.rotateEveryDays ?? null,
        passwordChangedAt: now,
        rotationDueAt: dueFrom(now, d.rotateEveryDays),
        createdBy: ctx.user.displayName,
      },
    });
    await audit(tx, ctx, { action: "create", entityType: "Credential", entityId: id, summary: `Created credential "${c.title}"`, after: meta(c) });
    return c;
  });
}

export async function updateCredential(ctx: Ctx, id: string, input: unknown) {
  const d = credentialInput.parse(input);
  const { cred } = await requireCredential(ctx, id, "edit");
  if (d.folderId !== cred.folderId) await requireFolder(ctx, d.folderId, "edit");
  const now = new Date();
  return db.$transaction(async (tx) => {
    const data: Prisma.CredentialUncheckedUpdateInput = {
      folderId: d.folderId,
      title: d.title,
      username: d.username ?? null,
      url: d.url ?? null,
      notes: d.notes ?? null,
      rotateEveryDays: d.rotateEveryDays ?? null,
      rotationDueAt: dueFrom(cred.passwordChangedAt, d.rotateEveryDays),
    };
    const changes: string[] = [];
    if (d.password && d.password !== decrypt(cred.secretEnc, aad.secret(id))) {
      await tx.credentialHistory.create({
        data: { credentialId: id, secretEnc: encrypt(decrypt(cred.secretEnc, aad.secret(id)), aad.history(id)), replacedBy: ctx.user.displayName },
      });
      data.secretEnc = encrypt(d.password, aad.secret(id));
      data.passwordChangedAt = now;
      data.rotationDueAt = dueFrom(now, d.rotateEveryDays);
      changes.push("password changed");
    }
    if (d.clearTotp) {
      if (cred.totpEnc) changes.push("TOTP removed");
      data.totpEnc = null;
    } else if (d.totpSeed) {
      data.totpEnc = encrypt(normaliseTotpSeed(d.totpSeed), aad.totp(id));
      changes.push(cred.totpEnc ? "TOTP replaced" : "TOTP added");
    }
    const after = await tx.credential.update({ where: { id }, data });
    const m = diff(meta(cred), meta(after));
    if (m.changed.length || changes.length)
      await audit(tx, ctx, {
        action: "update",
        entityType: "Credential",
        entityId: id,
        summary: `Updated credential "${after.title}": ${[...m.changed, ...changes].join(", ")}`,
        before: m.before,
        after: m.after,
      });
    return after;
  });
}

export async function deleteCredential(ctx: Ctx, id: string) {
  const { cred } = await requireCredential(ctx, id, "edit");
  await db.$transaction(async (tx) => {
    await tx.credential.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.entityLink.deleteMany({ where: { fromType: "Credential", fromId: id } });
    await audit(tx, ctx, { action: "delete", entityType: "Credential", entityId: id, summary: `Deleted credential "${cred.title}"` });
  });
}

export type CredentialListFilter = { folderId?: string; q?: string; due?: boolean };

/** Metadata only — secrets never leave the server except through reveal(). */
export async function listCredentials(ctx: Ctx, f: CredentialListFilter = {}) {
  assertCan(ctx.user.role, "vault", "read");
  const folders = await accessibleFolderIds(ctx);
  const ids = f.folderId ? folders.filter((x) => x === f.folderId) : folders;
  const ci = { contains: f.q ?? "", mode: "insensitive" as const };
  return db.credential.findMany({
    where: {
      deletedAt: null,
      folderId: { in: ids },
      ...(f.q ? { OR: [{ title: ci }, { username: ci }, { url: ci }, { notes: ci }] } : {}),
      ...(f.due ? { rotationDueAt: { lte: new Date(Date.now() + 14 * 86_400_000) } } : {}),
    },
    select: {
      id: true, title: true, username: true, url: true, folderId: true, rotationDueAt: true, passwordChangedAt: true, updatedAt: true,
      totpEnc: true, folder: { select: { name: true, restricted: true } },
    },
    orderBy: { title: "asc" },
    take: 500,
  }).then((rows) => rows.map(({ totpEnc, ...r }) => ({ ...r, hasTotp: !!totpEnc })));
}

export async function getCredential(ctx: Ctx, id: string) {
  const { cred, folder, access } = await requireCredential(ctx, id, "view");
  const [history, links] = await Promise.all([
    db.credentialHistory.findMany({ where: { credentialId: id }, select: { id: true, replacedAt: true, replacedBy: true }, orderBy: { replacedAt: "desc" }, take: 20 }),
    db.entityLink.findMany({ where: { fromType: "Credential", fromId: id, toType: "Asset" } }),
  ]);
  const assets = await db.asset.findMany({
    where: { id: { in: links.map((l) => l.toId) }, deletedAt: null },
    select: { id: true, tag: true, name: true, hostname: true },
    orderBy: { tag: "asc" },
  });
  const { secretEnc: _s, totpEnc, ...safe } = cred;
  void _s;
  return { ...safe, hasTotp: !!totpEnc, folder: { id: folder.id, name: folder.name, restricted: folder.restricted }, myAccess: access, history, assets };
}

export type RevealWhat = { field: "password" } | { field: "totp" } | { field: "history"; historyId: string };

/**
 * Decrypt and return a secret (or the current TOTP code). Every call is written to the audit log
 * as view_sensitive before the value is returned; if the audit write fails, nothing is revealed.
 */
export async function reveal(ctx: Ctx, id: string, what: RevealWhat, purpose: "reveal" | "copy" = "reveal") {
  const { cred } = await requireCredential(ctx, id, "view");
  let value: string;
  let label: string;
  if (what.field === "password") {
    value = decrypt(cred.secretEnc, aad.secret(id));
    label = "password";
  } else if (what.field === "totp") {
    if (!cred.totpEnc) throw new AppError("No TOTP seed stored for this credential.");
    value = await generateTotp({ secret: decrypt(cred.totpEnc, aad.totp(id)), guardrails: TOTP_GUARDRAILS });
    label = "TOTP code";
  } else {
    const h = await db.credentialHistory.findFirst({ where: { id: what.historyId, credentialId: id } });
    if (!h) throw new NotFoundError("History entry");
    value = decrypt(h.secretEnc, aad.history(id));
    label = `previous password (replaced ${h.replacedAt.toISOString().slice(0, 10)})`;
  }
  await audit(db, ctx, {
    action: "view_sensitive",
    entityType: "Credential",
    entityId: id,
    summary: `${purpose === "copy" ? "Copied" : "Revealed"} ${label} of "${cred.title}"`,
  });
  return value;
}

// ───────────────────────────── Links to assets ─────────────────────────────

export async function linkAsset(ctx: Ctx, credentialId: string, assetId: string) {
  const { cred } = await requireCredential(ctx, credentialId, "edit");
  const asset = await db.asset.findFirst({ where: { id: assetId, deletedAt: null } });
  if (!asset) throw new NotFoundError("Asset");
  await db.$transaction(async (tx) => {
    await tx.entityLink.upsert({
      where: { fromType_fromId_toType_toId_kind: { fromType: "Credential", fromId: credentialId, toType: "Asset", toId: assetId, kind: "credential_for" } },
      create: { fromType: "Credential", fromId: credentialId, toType: "Asset", toId: assetId, kind: "credential_for" },
      update: {},
    });
    await audit(tx, ctx, { action: "link", entityType: "Credential", entityId: credentialId, summary: `Linked credential "${cred.title}" to asset ${asset.tag}` });
  });
}

export async function unlinkAsset(ctx: Ctx, credentialId: string, assetId: string) {
  const { cred } = await requireCredential(ctx, credentialId, "edit");
  await db.$transaction(async (tx) => {
    await tx.entityLink.deleteMany({ where: { fromType: "Credential", fromId: credentialId, toType: "Asset", toId: assetId } });
    await audit(tx, ctx, { action: "unlink", entityType: "Credential", entityId: credentialId, summary: `Unlinked credential "${cred.title}" from asset ${assetId}` });
  });
}

/** Credentials linked to an asset that this user may see (titles only). */
export async function credentialsForAsset(ctx: Ctx, assetId: string) {
  if (!can(ctx.user.role, "vault", "read")) return [];
  const links = await db.entityLink.findMany({ where: { fromType: "Credential", toType: "Asset", toId: assetId } });
  if (!links.length) return [];
  const folders = await accessibleFolderIds(ctx);
  return db.credential.findMany({
    where: { id: { in: links.map((l) => l.fromId) }, deletedAt: null, folderId: { in: folders } },
    select: { id: true, title: true, username: true },
    orderBy: { title: "asc" },
  });
}
