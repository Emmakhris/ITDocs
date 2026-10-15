import "server-only";
import { z } from "zod";
import { AssetStatus, MoveMethod, Prisma, type Asset } from "@prisma/client";
import { db, type Tx } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { checkbox, optDate, optNum, optStr } from "../lib/forms";
import { parseFieldDefs, validateCustomFields } from "../lib/custom-fields";
import { descendantIds, locationPath } from "./locations";
import { getSettings } from "./settings";
import type { Ctx } from "../context";

// ───────────────────────────── Input schemas ─────────────────────────────

export const assetInput = z.object({
  tag: optStr(40),
  name: z.string().trim().min(1, "Name is required").max(160),
  typeId: z.string().min(1, "Type is required"),
  status: z.nativeEnum(AssetStatus).default("IN_STOCK"),
  manufacturer: optStr(120),
  model: optStr(120),
  serial: optStr(120),
  hostname: optStr(120),
  ipAddress: optStr(60),
  macAddress: optStr(40),
  os: optStr(120),
  locationId: optStr(40),
  assigneeId: optStr(40),
  departmentId: optStr(40),
  vendorName: optStr(120),
  purchaseDate: optDate,
  purchaseCost: optNum,
  poNumber: optStr(60),
  warrantyEnd: optDate,
  eolDate: optDate,
  udi: optStr(120),
  riskClass: optStr(40),
  biomedOwner: optStr(120),
  pmIntervalDays: optNum,
  lastPmDate: optDate,
  nextPmDate: optDate,
  storesPhi: checkbox,
  networkSegmented: checkbox,
  notes: optStr(10000),
  /** Reason recorded on the movement log when location/assignee/status changes during an edit. */
  changeReason: optStr(500),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export type AssetInput = z.input<typeof assetInput>;

export const moveInput = z.object({
  toLocationId: optStr(40),
  toAssigneeId: optStr(40),
  clearAssignee: checkbox,
  toStatus: z.nativeEnum(AssetStatus).optional(),
  reason: z.string().trim().min(1, "A reason is required for the movement log").max(500),
  ticketRef: optStr(60),
  movedAt: optDate,
});

// ───────────────────────────── Queries ─────────────────────────────

export type AssetListFilter = {
  q?: string;
  status?: AssetStatus;
  typeId?: string;
  locationId?: string; // includes sub-locations
  assigneeId?: string;
  medical?: boolean;
  phi?: boolean;
  warrantyBefore?: Date;
  sort?: "tag" | "name" | "status" | "updatedAt" | "warrantyEnd";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export async function assetWhere(f: AssetListFilter): Promise<Prisma.AssetWhereInput> {
  const where: Prisma.AssetWhereInput = { deletedAt: null };
  if (f.status) where.status = f.status;
  if (f.typeId) where.typeId = f.typeId;
  if (f.assigneeId) where.assigneeId = f.assigneeId;
  if (f.medical) where.type = { isMedical: true };
  if (f.phi) where.storesPhi = true;
  if (f.warrantyBefore) where.warrantyEnd = { gte: new Date(), lte: f.warrantyBefore };
  if (f.locationId) where.locationId = { in: await descendantIds(f.locationId) };
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { tag: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { serial: { contains: q, mode: "insensitive" } },
      { hostname: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { ipAddress: { startsWith: q } },
      { macAddress: { contains: q, mode: "insensitive" } },
      { assignee: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export async function listAssets(ctx: Ctx, f: AssetListFilter) {
  assertCan(ctx.user.role, "assets", "read");
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);
  const where = await assetWhere(f);
  const [rows, total] = await Promise.all([
    db.asset.findMany({
      where,
      include: { type: true, location: true, assignee: true },
      orderBy: { [f.sort ?? "tag"]: f.dir ?? "asc" },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.asset.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getAsset(ctx: Ctx, idOrTag: string) {
  assertCan(ctx.user.role, "assets", "read");
  const asset = await db.asset.findFirst({
    where: { OR: [{ id: idOrTag }, { tag: idOrTag }], deletedAt: null },
    include: {
      type: true,
      location: true,
      assignee: true,
      department: true,
      disposal: true,
      checkouts: { include: { person: true, checkedOutBy: true }, orderBy: { outAt: "desc" }, take: 20 },
    },
  });
  if (!asset) throw new NotFoundError("Asset");
  if (asset.storesPhi) {
    await audit(db, ctx, { action: "view_sensitive", entityType: "Asset", entityId: asset.id, summary: `Viewed PHI-flagged device ${asset.tag}` });
  }
  return { ...asset, fieldDefs: parseFieldDefs(asset.type.fieldDefs), locationPath: await locationPath(db, asset.locationId) };
}

export async function assetMovements(ctx: Ctx, assetId: string, take = 200) {
  assertCan(ctx.user.role, "assets", "read");
  return db.assetMovement.findMany({ where: { assetId }, orderBy: { movedAt: "desc" }, take });
}

/** Where was this asset (and with whom) at a given moment? Answers audit / incident questions. */
export async function assetAt(ctx: Ctx, assetId: string, at: Date) {
  assertCan(ctx.user.role, "assets", "read");
  return db.assetMovement.findFirst({ where: { assetId, movedAt: { lte: at } }, orderBy: { movedAt: "desc" } });
}

export async function recentMovements(ctx: Ctx, opts: { take?: number; skip?: number; locationId?: string; q?: string } = {}) {
  assertCan(ctx.user.role, "assets", "read");
  const where: Prisma.AssetMovementWhereInput = {};
  if (opts.locationId) {
    const ids = await descendantIds(opts.locationId);
    where.OR = [{ toLocationId: { in: ids } }, { fromLocationId: { in: ids } }];
  }
  if (opts.q) where.asset = { OR: [{ tag: { contains: opts.q, mode: "insensitive" } }, { name: { contains: opts.q, mode: "insensitive" } }] };
  const [rows, total] = await Promise.all([
    db.assetMovement.findMany({
      where,
      include: { asset: { select: { id: true, tag: true, name: true } } },
      orderBy: { movedAt: "desc" },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
    }),
    db.assetMovement.count({ where }),
  ]);
  return { rows, total };
}

// ───────────────────────────── Movement recording ─────────────────────────────

type Placement = { locationId: string | null; assigneeId: string | null; status: AssetStatus };

/**
 * Writes an AssetMovement row when location, assignee or status differs between `from` and `to`.
 * Every code path that changes those fields MUST call this — it is the backbone of device tracking.
 */
export async function recordMovement(
  tx: Tx,
  ctx: Ctx | null,
  assetId: string,
  from: Placement | null,
  to: Placement,
  method: MoveMethod,
  extra: { reason?: string; ticketRef?: string; movedAt?: Date; force?: boolean } = {},
) {
  const changed =
    !from || from.locationId !== to.locationId || from.assigneeId !== to.assigneeId || from.status !== to.status;
  // `force` records a verification (e.g. scanned during an inventory audit) even when nothing moved
  if (!changed && !extra.force) return null;
  const personName = async (id: string | null) =>
    id ? (await tx.person.findUnique({ where: { id }, select: { name: true } }))?.name ?? null : null;
  return tx.assetMovement.create({
    data: {
      assetId,
      method,
      movedById: ctx?.user.id || null,
      movedByName: ctx?.user.displayName ?? "system",
      movedAt: extra.movedAt ?? new Date(),
      fromLocationId: from?.locationId ?? null,
      toLocationId: to.locationId,
      fromLocationPath: await locationPath(tx, from?.locationId),
      toLocationPath: await locationPath(tx, to.locationId),
      fromAssignee: await personName(from?.assigneeId ?? null),
      toAssignee: await personName(to.assigneeId),
      fromStatus: from?.status ?? null,
      toStatus: to.status,
      reason: extra.reason,
      ticketRef: extra.ticketRef,
    },
  });
}

const placement = (a: Pick<Asset, "locationId" | "assigneeId" | "status">): Placement => ({
  locationId: a.locationId,
  assigneeId: a.assigneeId,
  status: a.status,
});

// ───────────────────────────── Mutations ─────────────────────────────

async function nextTag(tx: Tx, prefix: string) {
  const key = `seq.assetTag.${prefix}`;
  const row = await tx.setting.findUnique({ where: { key } });
  let n = (typeof row?.value === "number" ? row.value : 0) + 1;
  // Skip tags that were entered manually
  while (await tx.asset.findUnique({ where: { tag: `${prefix}${String(n).padStart(6, "0")}` }, select: { id: true } })) n++;
  await tx.setting.upsert({ where: { key }, create: { key, value: n }, update: { value: n } });
  return `${prefix}${String(n).padStart(6, "0")}`;
}

async function prepare(tx: Tx, raw: unknown) {
  const data = assetInput.parse(raw);
  const type = await tx.assetType.findFirst({ where: { id: data.typeId, deletedAt: null } });
  if (!type) throw new AppError("Unknown asset type.");
  const { values, errors } = validateCustomFields(parseFieldDefs(type.fieldDefs), data.customFields);
  if (Object.keys(errors).length) {
    throw new FieldError(Object.fromEntries(Object.entries(errors).map(([k, m]) => ["cf_" + k, m])));
  }
  const { changeReason, customFields: _cf, tag, ...rest } = data;
  void _cf;
  const row = {
    ...rest,
    purchaseCost: rest.purchaseCost === undefined ? null : new Prisma.Decimal(rest.purchaseCost),
    pmIntervalDays: rest.pmIntervalDays === undefined ? null : Math.round(rest.pmIntervalDays),
    customFields: values,
  };
  // Full-replace semantics: every schema field absent or blank in the input is cleared (null)
  const r = row as Record<string, unknown>;
  for (const k of Object.keys(assetInput.shape)) {
    if (k === "changeReason" || k === "customFields" || k === "tag") continue;
    if (r[k] === undefined) r[k] = null;
  }
  if (row.pmIntervalDays && row.lastPmDate && !data.nextPmDate) {
    row.nextPmDate = new Date(row.lastPmDate.getTime() + row.pmIntervalDays * 86_400_000);
  }
  return { row, tag, type, changeReason };
}

export async function createAsset(ctx: Ctx, raw: unknown, method: MoveMethod = "CREATE") {
  assertCan(ctx.user.role, "assets", "write");
  const settings = await getSettings();
  return db.$transaction(async (tx) => {
    const { row, tag, type } = await prepare(tx, raw);
    const finalTag = tag ?? (await nextTag(tx, type.tagPrefix ?? settings.assetTagPrefix));
    if (await tx.asset.findUnique({ where: { tag: finalTag }, select: { id: true } }))
      throw new AppError(`Asset tag ${finalTag} is already in use.`);
    const asset = await tx.asset.create({ data: { ...row, tag: finalTag } as Prisma.AssetUncheckedCreateInput });
    await recordMovement(tx, ctx, asset.id, null, placement(asset), method, { reason: method === "IMPORT" ? "Imported" : "Asset created" });
    await audit(tx, ctx, { action: "create", entityType: "Asset", entityId: asset.id, summary: `Created asset ${asset.tag} (${asset.name})`, after: asset });
    return asset;
  });
}

export async function updateAsset(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx.user.role, "assets", "write");
  return db.$transaction(async (tx) => {
    const before = await tx.asset.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError("Asset");
    if (before.status === "DISPOSED") throw new AppError("Disposed assets are read-only.");
    const { row, tag, changeReason } = await prepare(tx, raw);
    const after = await tx.asset.update({ where: { id }, data: { ...row, tag: tag ?? before.tag } as Prisma.AssetUncheckedUpdateInput });
    await recordMovement(tx, ctx, id, placement(before), placement(after), "MANUAL", { reason: changeReason ?? "Edited asset record" });
    const d = diff(before, after);
    if (d.changed.length)
      await audit(tx, ctx, { action: "update", entityType: "Asset", entityId: id, summary: `Updated ${after.tag}: ${d.changed.join(", ")}`, before: d.before, after: d.after });
    return after;
  });
}

/** Move one or many assets (manual form, QR scan, bulk). */
export async function moveAssets(ctx: Ctx, ids: string[], raw: unknown, method: MoveMethod = "MANUAL") {
  assertCan(ctx.user.role, "assets", "write");
  const m = moveInput.parse(raw);
  if (!m.toLocationId && !m.toAssigneeId && !m.clearAssignee && !m.toStatus && method !== "SCAN")
    throw new AppError("Choose a new location, assignee or status.");
  if (!ids.length) throw new AppError("No assets selected.");
  if (ids.length > 500) throw new AppError("Move at most 500 assets at once.");
  return db.$transaction(async (tx) => {
    let moved = 0;
    for (const id of ids) {
      const before = await tx.asset.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundError("Asset");
      if (before.status === "DISPOSED") throw new AppError(`${before.tag} is disposed and cannot be moved.`);
      const to: Placement = {
        locationId: m.toLocationId ?? before.locationId,
        assigneeId: m.clearAssignee ? null : (m.toAssigneeId ?? before.assigneeId),
        status: m.toStatus ?? before.status,
      };
      const mv = await recordMovement(tx, ctx, id, placement(before), to, ids.length > 1 && method === "MANUAL" ? "BULK" : method, {
        reason: m.reason,
        ticketRef: m.ticketRef,
        movedAt: m.movedAt,
        force: method === "SCAN",
      });
      if (!mv) continue;
      await tx.asset.update({ where: { id }, data: to });
      await audit(tx, ctx, {
        action: "move",
        entityType: "Asset",
        entityId: id,
        summary: mv.fromLocationPath === mv.toLocationPath && mv.fromAssignee === mv.toAssignee && before.status === to.status
          ? `Verified ${before.tag} at ${mv.toLocationPath ?? "—"} (scan)`
          : `Moved ${before.tag}: ${mv.fromLocationPath ?? "—"} → ${mv.toLocationPath ?? "—"}${mv.toAssignee !== mv.fromAssignee ? `; assignee ${mv.fromAssignee ?? "—"} → ${mv.toAssignee ?? "—"}` : ""}${before.status !== to.status ? `; status ${before.status} → ${to.status}` : ""}. Reason: ${m.reason}`,
      });
      moved++;
    }
    return { moved };
  });
}

// ───────────────────────────── Check-out / check-in ─────────────────────────────

export const checkoutInput = z.object({
  personId: z.string().min(1, "Choose who is borrowing it"),
  dueAt: optDate,
  outCondition: optStr(500),
  notes: optStr(1000),
  toLocationId: optStr(40),
});

export async function checkoutAsset(ctx: Ctx, assetId: string, raw: unknown) {
  assertCan(ctx.user.role, "assets", "write");
  const c = checkoutInput.parse(raw);
  return db.$transaction(async (tx) => {
    const a = await tx.asset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!a) throw new NotFoundError("Asset");
    if (["DISPOSED", "RETIRED", "LOST"].includes(a.status)) throw new AppError(`Asset is ${a.status.toLowerCase()} and cannot be checked out.`);
    if (await tx.checkout.findFirst({ where: { assetId, returnedAt: null } })) throw new AppError("Asset is already checked out.");
    const co = await tx.checkout.create({
      data: { assetId, personId: c.personId, checkedOutById: ctx.user.id, dueAt: c.dueAt, outCondition: c.outCondition, notes: c.notes },
      include: { person: true },
    });
    const to: Placement = { locationId: c.toLocationId ?? a.locationId, assigneeId: c.personId, status: "LOANED" };
    await recordMovement(tx, ctx, assetId, placement(a), to, "CHECKOUT", {
      reason: `Checked out to ${co.person.name}${c.dueAt ? ` (due ${c.dueAt.toISOString().slice(0, 10)})` : ""}`,
    });
    await tx.asset.update({ where: { id: assetId }, data: to });
    await audit(tx, ctx, { action: "checkout", entityType: "Asset", entityId: assetId, summary: `Checked out ${a.tag} to ${co.person.name}` });
    return co;
  });
}

export const checkinInput = z.object({
  toLocationId: optStr(40),
  toStatus: z.nativeEnum(AssetStatus).default("IN_STOCK"),
  inCondition: optStr(500),
});

export async function checkinAsset(ctx: Ctx, assetId: string, raw: unknown, method: MoveMethod = "CHECKIN") {
  assertCan(ctx.user.role, "assets", "write");
  const c = checkinInput.parse(raw);
  return db.$transaction(async (tx) => {
    const a = await tx.asset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!a) throw new NotFoundError("Asset");
    const open = await tx.checkout.findFirst({ where: { assetId, returnedAt: null }, include: { person: true } });
    if (!open) throw new AppError("Asset is not checked out.");
    await tx.checkout.update({ where: { id: open.id }, data: { returnedAt: new Date(), inCondition: c.inCondition } });
    const to: Placement = { locationId: c.toLocationId ?? a.locationId, assigneeId: null, status: c.toStatus };
    await recordMovement(tx, ctx, assetId, placement(a), to, method, {
      reason: `Returned by ${open.person.name}${c.inCondition ? ` — ${c.inCondition}` : ""}`,
    });
    await tx.asset.update({ where: { id: assetId }, data: to });
    await audit(tx, ctx, { action: "checkin", entityType: "Asset", entityId: assetId, summary: `Checked in ${a.tag} from ${open.person.name}` });
  });
}

export async function overdueCheckouts() {
  return db.checkout.findMany({
    where: { returnedAt: null, dueAt: { lt: new Date() } },
    include: { asset: true, person: true },
    orderBy: { dueAt: "asc" },
  });
}

// ───────────────────────────── Lifecycle: disposal ─────────────────────────────

export const disposalInput = z.object({
  disposedAt: optDate.refine((d) => !!d, "Date is required"),
  method: z.string().trim().min(1, "Method is required").max(60),
  wipeMethod: optStr(120),
  certificateRef: optStr(120),
  vendor: optStr(120),
  witness: optStr(120),
  notes: optStr(2000),
});

export async function disposeAsset(ctx: Ctx, assetId: string, raw: unknown) {
  assertCan(ctx.user.role, "assets", "write");
  const d = disposalInput.parse(raw);
  return db.$transaction(async (tx) => {
    const a = await tx.asset.findFirst({ where: { id: assetId, deletedAt: null } });
    if (!a) throw new NotFoundError("Asset");
    if (a.status === "DISPOSED") throw new AppError("Asset is already disposed.");
    if (await tx.checkout.findFirst({ where: { assetId, returnedAt: null } })) throw new AppError("Check the asset in before disposing of it.");
    if (a.storesPhi && !d.wipeMethod) throw new AppError("This device stores PHI — record the data-wipe method before disposal.");
    await tx.disposal.create({ data: { ...d, disposedAt: d.disposedAt!, assetId, recordedBy: ctx.user.displayName } });
    const to: Placement = { locationId: null, assigneeId: null, status: "DISPOSED" };
    await recordMovement(tx, ctx, assetId, placement(a), to, "DISPOSAL", {
      reason: `Disposed: ${d.method}${d.wipeMethod ? `, wiped (${d.wipeMethod})` : ""}`,
      ticketRef: d.certificateRef,
    });
    await tx.asset.update({ where: { id: assetId }, data: to });
    await audit(tx, ctx, { action: "dispose", entityType: "Asset", entityId: assetId, summary: `Disposed ${a.tag} (${d.method})`, after: d });
  });
}

export async function deleteAsset(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "assets", "write");
  await db.$transaction(async (tx) => {
    const a = await tx.asset.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "delete", entityType: "Asset", entityId: id, summary: `Deleted asset record ${a.tag}` });
  });
}
