import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { LicenseModel, Prisma, SeatBasis } from "@prisma/client";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { checkbox, nulls, optDate, optNum, optStr } from "../lib/forms";
import { licenseState, seatUsage } from "../lib/renewals";
import { aad, decrypt, encrypt } from "../crypto/vault";
import { revealAllowed } from "./vault";
import type { Ctx } from "../context";

// Software catalogue, licences (keys encrypted with the vault master key) and seat assignments to
// devices or people. Over-allocation is allowed — installs happen before paperwork — but is flagged
// everywhere so it can be fixed before a vendor audit.

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export const softwareInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  vendorId: optStr(40),
  category: optStr(80),
  website: optStr(500).refine((u) => !u || /^https?:\/\/\S+$/i.test(u), "Must start with http:// or https://"),
  notes: optStr(4000),
});

export const licenseInput = z
  .object({
    softwareId: z.string().min(1, "Software is required"),
    name: z.string().trim().min(1, "Name is required").max(160),
    model: z.nativeEnum(LicenseModel).default("SUBSCRIPTION"),
    seatBasis: z.nativeEnum(SeatBasis).default("USER"),
    seats: optNum.refine((n) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 1_000_000), "Whole number from 1"),
    /** Blank on edit keeps the stored key */
    licenseKey: z.string().max(4000).optional().transform((s) => s?.trim() || undefined),
    clearKey: checkbox,
    vendorId: optStr(40),
    contractId: optStr(40),
    poNumber: optStr(60),
    purchaseDate: optDate,
    cost: optNum.refine((n) => n === undefined || (n >= 0 && n < 1e10), "Must be a positive amount"),
    expiresAt: optDate,
    notes: optStr(4000),
  })
  .refine((l) => l.seatBasis === "SITE" || l.seats !== undefined, { path: ["seats"], message: "Enter the number of seats (or choose Site licence)" });

export const assignInput = z.object({ assetId: optStr(40), personId: optStr(40), notes: optStr(300) });

// ───────────────────────────── Software titles ─────────────────────────────

type LicenseRow = { id: string; seats: number | null; seatBasis: SeatBasis; expiresAt: Date | null; _count: { assignments: number } };

function summarise(licenses: LicenseRow[]) {
  const now = new Date();
  const unlimited = licenses.some((l) => l.seatBasis === "SITE" || l.seats === null);
  const seats = licenses.reduce((n, l) => n + (l.seats ?? 0), 0);
  const used = licenses.reduce((n, l) => n + l._count.assignments, 0);
  const over = licenses.reduce((n, l) => n + seatUsage(l.seatBasis === "SITE" ? null : l.seats, l._count.assignments).over, 0);
  const expiries = licenses.map((l) => l.expiresAt).filter((d): d is Date => !!d && d >= now).sort((a, b) => a.getTime() - b.getTime());
  const expired = licenses.filter((l) => licenseState(l.expiresAt, now).state === "expired").length;
  return { licenses: licenses.length, seats: unlimited ? null : seats, used, over, nextExpiry: expiries[0] ?? null, expired };
}

const licenseCount = { where: { deletedAt: null }, select: { id: true, seats: true, seatBasis: true, expiresAt: true, _count: { select: { assignments: true } } } } as const;

export async function listSoftware(ctx: Ctx, f: { q?: string; issues?: boolean } = {}) {
  assertCan(ctx.user.role, "software", "read");
  const where: Prisma.SoftwareWhereInput = { deletedAt: null };
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { category: { contains: f.q, mode: "insensitive" } }, { vendor: { name: { contains: f.q, mode: "insensitive" } } }];
  const rows = await db.software.findMany({ where, include: { vendor: { select: { id: true, name: true } }, licenses: licenseCount }, orderBy: { name: "asc" } });
  const out = rows.map(({ licenses, ...s }) => ({ ...s, summary: summarise(licenses) }));
  return f.issues ? out.filter((s) => s.summary.over > 0 || s.summary.expired > 0) : out;
}

export async function softwareOptions() {
  return db.software.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function getSoftware(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "software", "read");
  const s = await db.software.findFirst({
    where: { id, deletedAt: null },
    include: {
      vendor: { select: { id: true, name: true } },
      licenses: { where: { deletedAt: null }, include: { _count: { select: { assignments: true } }, contract: { select: { id: true, title: true } } }, orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }] },
    },
  });
  if (!s) throw new NotFoundError("Software");
  const now = new Date();
  return {
    ...s,
    summary: summarise(s.licenses),
    licenses: s.licenses.map(({ keyEnc, cost, ...l }) => ({ ...l, cost: cost?.toString() ?? null, hasKey: !!keyEnc, usage: seatUsage(l.seatBasis === "SITE" ? null : l.seats, l._count.assignments), ...licenseState(l.expiresAt, now) })),
  };
}

export async function saveSoftware(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "software", "write");
  const data = nulls(softwareInput, softwareInput.parse(input));
  if (data.vendorId && !(await db.vendor.findFirst({ where: { id: data.vendorId, deletedAt: null } }))) throw new FieldError({ vendorId: "Vendor not found" });
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const s = await tx.software.create({ data });
        await audit(tx, ctx, { action: "create", entityType: "Software", entityId: s.id, summary: `Added software ${s.name}`, after: s });
        return s;
      }
      const before = await tx.software.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError("Software");
      const after = await tx.software.update({ where: { id }, data });
      const d = diff(before, after);
      if (d.changed.length) await audit(tx, ctx, { action: "update", entityType: "Software", entityId: id, summary: `Updated software ${after.name}`, before: d.before, after: d.after });
      return after;
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ name: "That software is already in the catalogue" });
    throw e;
  }
}

export async function deleteSoftware(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "software", "write");
  const n = await db.license.count({ where: { softwareId: id, deletedAt: null } });
  if (n) throw new AppError(`Delete its ${n} licence(s) first.`);
  await db.$transaction(async (tx) => {
    const s = await tx.software.findUniqueOrThrow({ where: { id } });
    await tx.software.update({ where: { id }, data: { deletedAt: new Date(), name: `${s.name} (deleted ${id.slice(-6)})` } });
    await audit(tx, ctx, { action: "delete", entityType: "Software", entityId: id, summary: `Deleted software ${s.name}` });
  });
}

// ───────────────────────────── Licences ─────────────────────────────

export async function getLicense(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "software", "read");
  const l = await db.license.findFirst({
    where: { id, deletedAt: null },
    include: {
      software: { select: { id: true, name: true } },
      vendor: { select: { id: true, name: true } },
      contract: { select: { id: true, title: true, deletedAt: true } },
      assignments: {
        include: { asset: { select: { id: true, tag: true, name: true, status: true, deletedAt: true } }, person: { select: { id: true, name: true, active: true, deletedAt: true } } },
        orderBy: { assignedAt: "desc" },
      },
    },
  });
  if (!l) throw new NotFoundError("Licence");
  const { keyEnc, cost, ...rest } = l;
  return {
    ...rest,
    cost: cost?.toString() ?? null,
    hasKey: !!keyEnc,
    usage: seatUsage(l.seatBasis === "SITE" ? null : l.seats, l.assignments.length),
    ...licenseState(l.expiresAt),
    // Seats held by retired/disposed devices or people who have left: reclaim candidates
    stale: l.assignments.filter((a) => (a.asset && (a.asset.deletedAt || ["RETIRED", "DISPOSED", "LOST"].includes(a.asset.status))) || (a.person && (!a.person.active || a.person.deletedAt))).length,
  };
}

async function checkLicenseRefs(d: z.output<typeof licenseInput>) {
  const errs: Record<string, string> = {};
  if (!(await db.software.findFirst({ where: { id: d.softwareId, deletedAt: null } }))) errs.softwareId = "Software not found";
  if (d.vendorId && !(await db.vendor.findFirst({ where: { id: d.vendorId, deletedAt: null } }))) errs.vendorId = "Vendor not found";
  if (d.contractId && !(await db.contract.findFirst({ where: { id: d.contractId, deletedAt: null } }))) errs.contractId = "Contract not found";
  if (Object.keys(errs).length) throw new FieldError(errs);
}

/** Licence fields for the audit log: never the key, only whether one is stored. */
const auditView = ({ keyEnc, ...l }: { keyEnc: string | null } & Record<string, unknown>) => ({ ...l, hasKey: !!keyEnc });

export async function saveLicense(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "software", "write");
  const d = licenseInput.parse(input);
  await checkLicenseRefs(d);
  const { licenseKey, clearKey, ...fields } = nulls(licenseInput, d);
  const data = { ...fields, seats: d.seatBasis === "SITE" ? null : (d.seats ?? null) };
  return db.$transaction(async (tx) => {
    if (!id) {
      const newId = crypto.randomUUID();
      const l = await tx.license.create({ data: { ...data, id: newId, keyEnc: licenseKey ? encrypt(licenseKey, aad.license(newId)) : null } });
      await audit(tx, ctx, { action: "create", entityType: "License", entityId: l.id, summary: `Added licence "${l.name}"${l.seats ? ` (${l.seats} seats)` : ""}`, after: auditView(l) });
      return l;
    }
    const before = await tx.license.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError("Licence");
    const keyEnc = licenseKey ? encrypt(licenseKey, aad.license(id)) : clearKey ? null : before.keyEnc;
    const after = await tx.license.update({ where: { id }, data: { ...data, keyEnc } });
    const df = diff(auditView(before), auditView(after));
    const keyChanged = keyEnc !== before.keyEnc;
    if (df.changed.length || keyChanged)
      await audit(tx, ctx, {
        action: "update",
        entityType: "License",
        entityId: id,
        summary: `Updated licence "${after.name}"${keyChanged ? (keyEnc ? " (new key stored)" : " (key removed)") : ""}`,
        before: df.before,
        after: df.after,
      });
    return after;
  });
}

export async function deleteLicense(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "software", "write");
  await db.$transaction(async (tx) => {
    const l = await tx.license.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { assignments: true } } } });
    if (!l) throw new NotFoundError("Licence");
    await tx.license.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "delete", entityType: "License", entityId: id, summary: `Deleted licence "${l.name}" (${l._count.assignments} seat assignment(s) kept for history)` });
  });
}

/** Decrypts the licence key. Technicians/admins only; every reveal is audited before the value leaves. */
export async function revealLicenseKey(ctx: Ctx, id: string, purpose: "reveal" | "copy" = "reveal") {
  assertCan(ctx.user.role, "software", "write");
  const l = await db.license.findFirst({ where: { id, deletedAt: null }, select: { name: true, keyEnc: true } });
  if (!l) throw new NotFoundError("Licence");
  if (!l.keyEnc) throw new AppError("No key stored for this licence.");
  await revealAllowed(ctx);
  const value = decrypt(l.keyEnc, aad.license(id));
  await audit(db, ctx, { action: "view_sensitive", entityType: "License", entityId: id, summary: `${purpose === "copy" ? "Copied" : "Revealed"} licence key of "${l.name}"` });
  return value;
}

// ───────────────────────────── Seats ─────────────────────────────

/**
 * Assigns a seat to a device or a person (per-device licences need a device, per-user a person).
 * Returns how many seats the licence is over by afterwards, so the UI can warn.
 */
export async function assignSeat(ctx: Ctx, licenseId: string, input: unknown) {
  assertCan(ctx.user.role, "software", "write");
  const d = assignInput.parse(input);
  if (!!d.assetId === !!d.personId) throw new FieldError({ assetId: "Choose a device or a person" });
  try {
    return await db.$transaction(async (tx) => {
      const l = await tx.license.findFirst({ where: { id: licenseId, deletedAt: null }, include: { software: { select: { name: true } }, _count: { select: { assignments: true } } } });
      if (!l) throw new NotFoundError("Licence");
      if (l.seatBasis === "DEVICE" && !d.assetId) throw new FieldError({ personId: "This licence is per device — assign it to a device" });
      if (l.seatBasis === "USER" && !d.personId) throw new FieldError({ assetId: "This licence is per user — assign it to a person" });
      const holder = d.assetId
        ? await tx.asset.findFirst({ where: { id: d.assetId, deletedAt: null }, select: { tag: true } }).then((a) => a?.tag)
        : await tx.person.findFirst({ where: { id: d.personId, deletedAt: null }, select: { name: true } }).then((p) => p?.name);
      if (!holder) throw new FieldError(d.assetId ? { assetId: "Device not found" } : { personId: "Person not found" });
      const a = await tx.licenseAssignment.create({ data: { licenseId, assetId: d.assetId ?? null, personId: d.personId ?? null, notes: d.notes ?? null, assignedBy: ctx.user.displayName } });
      const usage = seatUsage(l.seatBasis === "SITE" ? null : l.seats, l._count.assignments + 1);
      await audit(tx, ctx, {
        action: "assign",
        entityType: "License",
        entityId: licenseId,
        summary: `Assigned a ${l.software.name} seat ("${l.name}") to ${holder}${usage.over ? ` — over-allocated by ${usage.over}` : ""}`,
      });
      return { assignment: a, over: usage.over };
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError(d.assetId ? { assetId: "That device already has a seat on this licence" } : { personId: "That person already has a seat on this licence" });
    throw e;
  }
}

export async function unassignSeat(ctx: Ctx, assignmentId: string) {
  assertCan(ctx.user.role, "software", "write");
  return db.$transaction(async (tx) => {
    const a = await tx.licenseAssignment.findUnique({ where: { id: assignmentId }, include: { license: { select: { id: true, name: true } }, asset: { select: { tag: true } }, person: { select: { name: true } } } });
    if (!a) throw new NotFoundError("Seat");
    await tx.licenseAssignment.delete({ where: { id: assignmentId } });
    await audit(tx, ctx, { action: "unassign", entityType: "License", entityId: a.license.id, summary: `Released "${a.license.name}" seat from ${a.asset?.tag ?? a.person?.name}` });
    return a.license.id;
  });
}

/** Licences held by a device or a person (for their detail pages). */
export async function seatsFor(ctx: Ctx, holder: { assetId: string } | { personId: string }) {
  if (!can(ctx.user.role, "software", "read")) return [];
  return db.licenseAssignment.findMany({
    where: { ...holder, license: { deletedAt: null } },
    select: { id: true, assignedAt: true, license: { select: { id: true, name: true, expiresAt: true, software: { select: { id: true, name: true } } } } },
    orderBy: { license: { software: { name: "asc" } } },
  });
}

/** Compliance overview for the dashboard: licences over-allocated right now. */
export async function overAllocated(ctx: Ctx) {
  if (!can(ctx.user.role, "software", "read")) return [];
  const rows = await db.license.findMany({
    where: { deletedAt: null, seatBasis: { not: "SITE" }, seats: { not: null } },
    select: { id: true, name: true, seats: true, software: { select: { name: true } }, _count: { select: { assignments: true } } },
  });
  return rows.filter((l) => l._count.assignments > (l.seats ?? Infinity)).map((l) => ({ id: l.id, title: `${l.software.name} — ${l.name}`, over: l._count.assignments - l.seats! }));
}
