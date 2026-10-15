import "server-only";
import { z } from "zod";
import { ContractType, Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { checkbox, nulls, optDate, optNum, optStr } from "../lib/forms";
import { readStoredFile, removeStoredFile, storeFile } from "../lib/storage";
import { SOON_DAYS, actionDate, contractState, licenseState } from "../lib/renewals";
import { accessibleFolderIds } from "./vault";
import type { Ctx } from "../context";

// Vendor directory, support contacts and contracts (support, maintenance, warranty, lease,
// subscription…) with notice-period tracking, covered assets and contract documents.

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const webUrl = (max = 500) => optStr(max).refine((u) => !u || /^https?:\/\/\S+$/i.test(u), "Must start with http:// or https://");
const email = optStr(200).refine((e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), "Not a valid email address");

export const vendorInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  website: webUrl(),
  phone: optStr(60),
  email,
  accountNumber: optStr(80),
  supportPhone: optStr(60),
  supportEmail: email,
  supportUrl: webUrl(),
  notes: optStr(4000),
});

export const contactInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  role: optStr(120),
  email,
  phone: optStr(60),
  notes: optStr(1000),
});

export const contractInput = z
  .object({
    vendorId: z.string().min(1, "Vendor is required"),
    title: z.string().trim().min(1, "Title is required").max(200),
    type: z.nativeEnum(ContractType).default("SUPPORT"),
    reference: optStr(120),
    startDate: optDate,
    endDate: optDate,
    noticeDays: optNum.refine((n) => n === undefined || (Number.isInteger(n) && n >= 0 && n <= 730), "0–730 days"),
    autoRenew: checkbox,
    annualCost: optNum.refine((n) => n === undefined || (n >= 0 && n < 1e10), "Must be a positive amount"),
    sla: optStr(300),
    ownerName: optStr(120),
    credentialId: optStr(40),
    notes: optStr(4000),
  })
  .refine((c) => !c.startDate || !c.endDate || c.endDate >= c.startDate, { path: ["endDate"], message: "End date is before the start date" })
  .refine((c) => !c.noticeDays || c.endDate, { path: ["noticeDays"], message: "A notice period needs an end date" });

// ───────────────────────────── Vendors ─────────────────────────────

export async function listVendors(ctx: Ctx, f: { q?: string } = {}) {
  assertCan(ctx.user.role, "vendors", "read");
  const where: Prisma.VendorWhereInput = { deletedAt: null };
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { accountNumber: { contains: f.q, mode: "insensitive" } }, { contacts: { some: { name: { contains: f.q, mode: "insensitive" } } } }];
  return db.vendor.findMany({
    where,
    include: { _count: { select: { contracts: { where: { deletedAt: null } }, software: { where: { deletedAt: null } }, contacts: true } } },
    orderBy: { name: "asc" },
  });
}

export async function vendorOptions() {
  return db.vendor.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function getVendor(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "vendors", "read");
  const v = await db.vendor.findFirst({
    where: { id, deletedAt: null },
    include: {
      contacts: { orderBy: { name: "asc" } },
      contracts: { where: { deletedAt: null }, orderBy: [{ endDate: "asc" }] },
      software: { where: { deletedAt: null }, select: { id: true, name: true, category: true }, orderBy: { name: "asc" } },
    },
  });
  if (!v) throw new NotFoundError("Vendor");
  return v;
}

export async function saveVendor(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "vendors", "write");
  const data = nulls(vendorInput, vendorInput.parse(input));
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const v = await tx.vendor.create({ data });
        await audit(tx, ctx, { action: "create", entityType: "Vendor", entityId: v.id, summary: `Created vendor ${v.name}`, after: v });
        return v;
      }
      const before = await tx.vendor.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError("Vendor");
      const after = await tx.vendor.update({ where: { id }, data });
      const d = diff(before, after);
      if (d.changed.length) await audit(tx, ctx, { action: "update", entityType: "Vendor", entityId: id, summary: `Updated vendor ${after.name}`, before: d.before, after: d.after });
      return after;
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ name: "A vendor with that name already exists" });
    throw e;
  }
}

export async function deleteVendor(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "vendors", "write");
  const [contracts, software, licenses] = await Promise.all([
    db.contract.count({ where: { vendorId: id, deletedAt: null } }),
    db.software.count({ where: { vendorId: id, deletedAt: null } }),
    db.license.count({ where: { vendorId: id, deletedAt: null } }),
  ]);
  if (contracts + software + licenses) throw new AppError(`This vendor still has ${contracts} contract(s), ${software} software title(s) and ${licenses} licence(s). Remove or reassign them first.`);
  await db.$transaction(async (tx) => {
    // Free the unique name so a vendor can be re-created later; history stays in the audit log
    const v = await tx.vendor.update({ where: { id }, data: { deletedAt: new Date(), name: `${(await tx.vendor.findUniqueOrThrow({ where: { id } })).name} (deleted ${id.slice(-6)})` } });
    await audit(tx, ctx, { action: "delete", entityType: "Vendor", entityId: id, summary: `Deleted vendor ${v.name}` });
  });
}

export async function saveContact(ctx: Ctx, vendorId: string, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "vendors", "write");
  const data = nulls(contactInput, contactInput.parse(input));
  return db.$transaction(async (tx) => {
    const v = await tx.vendor.findFirst({ where: { id: vendorId, deletedAt: null } });
    if (!v) throw new NotFoundError("Vendor");
    if (!id) {
      const c = await tx.vendorContact.create({ data: { ...data, vendorId } });
      await audit(tx, ctx, { action: "create", entityType: "Vendor", entityId: vendorId, summary: `Added contact ${c.name} to ${v.name}`, after: c });
      return c;
    }
    const before = await tx.vendorContact.findFirst({ where: { id, vendorId } });
    if (!before) throw new NotFoundError("Contact");
    const after = await tx.vendorContact.update({ where: { id }, data });
    const d = diff(before, after);
    if (d.changed.length) await audit(tx, ctx, { action: "update", entityType: "Vendor", entityId: vendorId, summary: `Updated contact ${after.name} at ${v.name}`, before: d.before, after: d.after });
    return after;
  });
}

export async function deleteContact(ctx: Ctx, vendorId: string, id: string) {
  assertCan(ctx.user.role, "vendors", "write");
  await db.$transaction(async (tx) => {
    const c = await tx.vendorContact.findFirst({ where: { id, vendorId } });
    if (!c) throw new NotFoundError("Contact");
    await tx.vendorContact.delete({ where: { id } });
    await audit(tx, ctx, { action: "delete", entityType: "Vendor", entityId: vendorId, summary: `Removed contact ${c.name}`, before: c });
  });
}

// ───────────────────────────── Contracts ─────────────────────────────

export type ContractFilter = { q?: string; type?: ContractType; vendorId?: string; state?: "active" | "soon" | "expired" };

export async function listContracts(ctx: Ctx, f: ContractFilter = {}) {
  assertCan(ctx.user.role, "vendors", "read");
  const where: Prisma.ContractWhereInput = { deletedAt: null };
  if (f.type) where.type = f.type;
  if (f.vendorId) where.vendorId = f.vendorId;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { reference: { contains: f.q, mode: "insensitive" } }, { vendor: { name: { contains: f.q, mode: "insensitive" } } }];
  const rows = await db.contract.findMany({ where, include: { vendor: { select: { id: true, name: true } } }, orderBy: [{ endDate: { sort: "asc", nulls: "last" } }, { title: "asc" }] });
  const now = new Date();
  const withState = rows.map((c) => ({ ...c, annualCost: c.annualCost?.toString() ?? null, ...contractState(c, now), actionDate: actionDate(c, now) }));
  if (!f.state) return withState;
  return withState.filter((c) =>
    f.state === "expired" ? c.state === "expired" : f.state === "soon" ? ["notice-soon", "notice-passed", "expiring"].includes(c.state) : !["expired"].includes(c.state),
  );
}

export async function getContract(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "vendors", "read");
  const c = await db.contract.findFirst({
    where: { id, deletedAt: null },
    include: {
      vendor: { select: { id: true, name: true, supportPhone: true, supportEmail: true, supportUrl: true } },
      licenses: { where: { deletedAt: null }, select: { id: true, name: true, software: { select: { name: true } } } },
      credential: { select: { id: true, title: true, folderId: true, deletedAt: true } },
    },
  });
  if (!c) throw new NotFoundError("Contract");
  const [links, attachments, folders] = await Promise.all([
    db.entityLink.findMany({ where: { fromType: "Contract", fromId: id, toType: "Asset", kind: "covers" }, select: { toId: true } }),
    db.attachment.findMany({ where: { entityType: "Contract", entityId: id }, orderBy: { createdAt: "asc" } }),
    accessibleFolderIds(ctx),
  ]);
  const assets = can(ctx.user.role, "assets", "read")
    ? await db.asset.findMany({ where: { id: { in: links.map((l) => l.toId) }, deletedAt: null }, select: { id: true, tag: true, name: true, status: true }, orderBy: { tag: "asc" } })
    : [];
  const { credential, annualCost, ...rest } = c;
  return {
    ...rest,
    annualCost: annualCost?.toString() ?? null,
    ...contractState(c),
    // The support-portal login is only named for people who can open its vault folder
    credential: credential && !credential.deletedAt && folders.includes(credential.folderId) ? { id: credential.id, title: credential.title } : null,
    hasCredential: !!credential && !credential.deletedAt,
    assets,
    attachments,
  };
}

async function checkContractRefs(ctx: Ctx, d: z.output<typeof contractInput>, prevCredentialId: string | null) {
  if (!(await db.vendor.findFirst({ where: { id: d.vendorId, deletedAt: null } }))) throw new FieldError({ vendorId: "Vendor not found" });
  if (d.credentialId) {
    const cred = await db.credential.findFirst({ where: { id: d.credentialId, deletedAt: null }, select: { folderId: true } });
    if (!cred || !(await accessibleFolderIds(ctx)).includes(cred.folderId)) throw new FieldError({ credentialId: "Credential not found in a vault folder you can open" });
    return d.credentialId;
  }
  // Keep a link this user can't see rather than silently removing it
  if (prevCredentialId) {
    const prev = await db.credential.findUnique({ where: { id: prevCredentialId }, select: { folderId: true } });
    if (prev && !(await accessibleFolderIds(ctx)).includes(prev.folderId)) return prevCredentialId;
  }
  return null;
}

export async function saveContract(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "vendors", "write");
  const d = contractInput.parse(input);
  const before = id ? await db.contract.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !before) throw new NotFoundError("Contract");
  const credentialId = await checkContractRefs(ctx, d, before?.credentialId ?? null);
  const data = { ...nulls(contractInput, d), credentialId, annualCost: d.annualCost ?? null };
  return db.$transaction(async (tx) => {
    if (!before) {
      const c = await tx.contract.create({ data });
      await audit(tx, ctx, { action: "create", entityType: "Contract", entityId: c.id, summary: `Created contract "${c.title}"`, after: c });
      return c;
    }
    const after = await tx.contract.update({ where: { id: before.id }, data });
    const df = diff(before, after);
    if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "Contract", entityId: before.id, summary: `Updated contract "${after.title}"`, before: df.before, after: df.after });
    return after;
  });
}

export async function deleteContract(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "vendors", "write");
  await db.$transaction(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundError("Contract");
    await tx.contract.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.license.updateMany({ where: { contractId: id }, data: { contractId: null } });
    await audit(tx, ctx, { action: "delete", entityType: "Contract", entityId: id, summary: `Deleted contract "${c.title}"` });
  });
}

async function loadContract(tx: Tx | typeof db, id: string) {
  const c = await tx.contract.findFirst({ where: { id, deletedAt: null }, select: { id: true, title: true } });
  if (!c) throw new NotFoundError("Contract");
  return c;
}

export async function coverAsset(ctx: Ctx, contractId: string, assetId: string) {
  assertCan(ctx.user.role, "vendors", "write");
  const c = await loadContract(db, contractId);
  const a = await db.asset.findFirst({ where: { id: assetId, deletedAt: null }, select: { tag: true } });
  if (!a) throw new FieldError({ assetId: "Asset not found" });
  await db.$transaction(async (tx) => {
    const key = { fromType: "Contract", fromId: contractId, toType: "Asset", toId: assetId, kind: "covers" };
    if (await tx.entityLink.findUnique({ where: { fromType_fromId_toType_toId_kind: key } })) return;
    await tx.entityLink.create({ data: key });
    await audit(tx, ctx, { action: "link", entityType: "Contract", entityId: contractId, summary: `Contract "${c.title}" now covers ${a.tag}` });
  });
}

export async function uncoverAsset(ctx: Ctx, contractId: string, assetId: string) {
  assertCan(ctx.user.role, "vendors", "write");
  const c = await loadContract(db, contractId);
  await db.$transaction(async (tx) => {
    const r = await tx.entityLink.deleteMany({ where: { fromType: "Contract", fromId: contractId, toType: "Asset", toId: assetId, kind: "covers" } });
    if (r.count) await audit(tx, ctx, { action: "unlink", entityType: "Contract", entityId: contractId, summary: `Contract "${c.title}" no longer covers asset ${assetId}` });
  });
}

/** Contracts covering an asset (for the asset page). */
export async function contractsForAsset(ctx: Ctx, assetId: string) {
  if (!can(ctx.user.role, "vendors", "read")) return [];
  const links = await db.entityLink.findMany({ where: { fromType: "Contract", toType: "Asset", toId: assetId, kind: "covers" }, select: { fromId: true } });
  if (!links.length) return [];
  const rows = await db.contract.findMany({
    where: { id: { in: links.map((l) => l.fromId) }, deletedAt: null },
    select: { id: true, title: true, type: true, endDate: true, noticeDays: true, autoRenew: true, sla: true, vendor: { select: { id: true, name: true, supportPhone: true } } },
    orderBy: { endDate: "asc" },
  });
  return rows.map((c) => ({ ...c, ...contractState(c) }));
}

// ───────────────────────────── Contract documents ─────────────────────────────

export async function addContractFile(ctx: Ctx, contractId: string, file: File | null | undefined) {
  assertCan(ctx.user.role, "vendors", "write");
  const c = await loadContract(db, contractId);
  const stored = await storeFile("contracts", file);
  try {
    return await db.$transaction(async (tx) => {
      const att = await tx.attachment.create({ data: { ...stored, entityType: "Contract", entityId: contractId, uploadedBy: ctx.user.displayName } });
      await audit(tx, ctx, { action: "attach", entityType: "Contract", entityId: contractId, summary: `Attached ${att.fileName} to contract "${c.title}"` });
      return att;
    });
  } catch (e) {
    await removeStoredFile(stored.storageKey);
    throw e;
  }
}

export async function readContractFile(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "vendors", "read");
  const att = await db.attachment.findUnique({ where: { id } });
  if (!att || att.entityType !== "Contract") throw new NotFoundError("File");
  await loadContract(db, att.entityId);
  return { att, data: await readStoredFile(att.storageKey) };
}

export async function removeContractFile(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "vendors", "write");
  const att = await db.attachment.findUnique({ where: { id } });
  if (!att || att.entityType !== "Contract") throw new NotFoundError("File");
  await db.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id } });
    await audit(tx, ctx, { action: "detach", entityType: "Contract", entityId: att.entityId, summary: `Removed document ${att.fileName}` });
  });
  await removeStoredFile(att.storageKey);
  return att.entityId;
}

// ───────────────────────────── Renewals ─────────────────────────────

export type RenewalItem = {
  kind: "contract" | "license";
  id: string;
  title: string;
  vendor: string | null;
  href: string;
  due: Date;
  what: string;
  state: string;
  daysLeft: number;
};

/** Contracts whose notice deadline or end date, and licences whose expiry, fall within `days` (overdue included). */
export async function renewals(ctx: Ctx, days = SOON_DAYS): Promise<RenewalItem[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + days * 86_400_000);
  const items: RenewalItem[] = [];
  const dayDiff = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
  if (can(ctx.user.role, "vendors", "read")) {
    // Notice can fall due long before the end date, so filter in code on the computed action date
    const contracts = await db.contract.findMany({
      where: { deletedAt: null, endDate: { not: null, gte: new Date(now.getTime() - 30 * 86_400_000) } },
      include: { vendor: { select: { name: true } } },
    });
    for (const c of contracts) {
      const st = contractState(c, now);
      const due = actionDate(c, now)!;
      if (due > horizon) continue;
      const noticeAhead = st.noticeBy && st.noticeBy.getTime() >= now.getTime();
      items.push({
        kind: "contract",
        id: c.id,
        title: c.title,
        vendor: c.vendor.name,
        href: `/vendors/contracts/${c.id}`,
        due,
        what: noticeAhead ? `Notice deadline (${c.noticeDays} days before end)` : st.state === "expired" ? "Ended" : c.autoRenew ? "Renews automatically" : "Ends",
        state: st.state,
        daysLeft: dayDiff(due),
      });
    }
  }
  if (can(ctx.user.role, "software", "read")) {
    const licenses = await db.license.findMany({
      where: { deletedAt: null, expiresAt: { not: null, lte: horizon, gte: new Date(now.getTime() - 30 * 86_400_000) } },
      include: { software: { select: { name: true } }, vendor: { select: { name: true } } },
    });
    for (const l of licenses)
      items.push({
        kind: "license",
        id: l.id,
        title: `${l.software.name} — ${l.name}`,
        vendor: l.vendor?.name ?? null,
        href: `/software/licenses/${l.id}`,
        due: l.expiresAt!,
        what: l.model === "SUBSCRIPTION" ? "Subscription ends" : "Licence expires",
        state: licenseState(l.expiresAt, now).state,
        daysLeft: dayDiff(l.expiresAt!),
      });
  }
  return items.sort((a, b) => a.due.getTime() - b.due.getTime());
}
