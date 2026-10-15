import "server-only";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verify as verifyTotp } from "otplib";
import { Role } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError } from "../lib/errors";
import type { Ctx } from "../context";

export async function listUsers(ctx: Ctx) {
  assertCan(ctx.user.role, "admin", "read");
  return db.user.findMany({ orderBy: [{ active: "desc" }, { displayName: "asc" }] });
}

export async function setUserRoleActive(ctx: Ctx, id: string, role: Role, active: boolean) {
  assertCan(ctx.user.role, "admin", "write");
  if (id === ctx.user.id && (!active || role !== "ADMIN")) throw new AppError("You cannot demote or disable your own account.");
  await db.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id } });
    const after = await tx.user.update({ where: { id }, data: { role, active } });
    if (!active) await tx.session.deleteMany({ where: { userId: id } });
    await audit(tx, ctx, {
      action: "update",
      entityType: "User",
      entityId: id,
      summary: `User ${after.username}: role ${before.role}→${role}, active ${before.active}→${active}`,
      before: { role: before.role, active: before.active },
      after: { role, active },
    });
  });
}

export const passwordPolicy = z
  .string()
  .min(14, "Use at least 14 characters")
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), "Mix upper, lower case and digits");

export async function createLocalUser(ctx: Ctx | null, input: { username: string; displayName: string; password: string; role?: Role }) {
  if (ctx) assertCan(ctx.user.role, "admin", "write");
  const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, "3–40 chars: letters, digits . _ -").parse(input.username);
  const password = passwordPolicy.parse(input.password);
  if (await db.user.findUnique({ where: { username } })) throw new AppError("Username already exists.");
  return db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        username,
        displayName: input.displayName || username,
        role: input.role ?? "ADMIN",
        source: "LOCAL",
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    await audit(tx, ctx, { action: "create", entityType: "User", entityId: u.id, summary: `Created local (break-glass) account ${username}` });
    return u;
  });
}

export async function changeOwnPassword(ctx: Ctx, current: string, next: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (u.source !== "LOCAL" || !u.passwordHash) throw new AppError("Directory accounts change their password in Active Directory.");
  if (!(await bcrypt.compare(current, u.passwordHash))) throw new AppError("Current password is incorrect.");
  const hash = await bcrypt.hash(passwordPolicy.parse(next), 12);
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
    await audit(tx, ctx, { action: "password_change", entityType: "User", entityId: u.id, summary: "Changed own password" });
  });
}

/** Step 1 of TOTP enrolment: returns a fresh secret + otpauth URI (not yet active). */
export function newTotpSecret(username: string, issuer: string) {
  const secret = generateSecret();
  return { secret, uri: generateURI({ issuer, label: username, secret }) };
}

/** Step 2: verify a code against the pending secret, then enable MFA. */
export async function enableTotp(ctx: Ctx, secret: string, code: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (u.source !== "LOCAL") throw new AppError("MFA for directory accounts is enforced by your identity provider.");
  const r = await verifyTotp({ secret, token: code.replace(/\s/g, "") });
  if (!r.valid) throw new AppError("That code didn't match. Check your device clock and try again.");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: u.id }, data: { totpSecret: secret, totpEnabled: true } });
    await audit(tx, ctx, { action: "mfa_enable", entityType: "User", entityId: u.id, summary: "Enabled authenticator MFA" });
  });
}

// ── AD group → role mappings ──

export async function listGroupMappings() {
  return db.ldapGroupMapping.findMany({ orderBy: [{ priority: "desc" }, { groupName: "asc" }] });
}

export async function saveGroupMapping(ctx: Ctx, groupName: string, role: Role, priority: number) {
  assertCan(ctx.user.role, "admin", "write");
  const name = z.string().trim().min(1).max(200).parse(groupName);
  await db.$transaction(async (tx) => {
    await tx.ldapGroupMapping.upsert({ where: { groupName: name }, create: { groupName: name, role, priority }, update: { role, priority } });
    await audit(tx, ctx, { action: "update", entityType: "LdapGroupMapping", summary: `AD group "${name}" → ${role} (priority ${priority})` });
  });
}

export async function deleteGroupMapping(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "admin", "write");
  await db.$transaction(async (tx) => {
    const m = await tx.ldapGroupMapping.delete({ where: { id } });
    await audit(tx, ctx, { action: "delete", entityType: "LdapGroupMapping", summary: `Removed mapping for AD group "${m.groupName}"` });
  });
}
