import "server-only";
import { z } from "zod";
import { LocationType, Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError, NotFoundError } from "../lib/errors";
import { optStr } from "../lib/forms";
import type { Ctx } from "../context";

export const locationInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.nativeEnum(LocationType),
  code: optStr(40),
  parentId: optStr(40),
  address: optStr(300),
  notes: optStr(4000),
});

export type LocationNode = {
  id: string;
  name: string;
  type: LocationType;
  code: string | null;
  parentId: string | null;
  path: string;
  depth: number;
  assetCount: number;
};

/** All active locations, flattened in tree order with full paths ("Main Campus › Tower A › 3F › Rm 301"). */
export async function locationTree(): Promise<LocationNode[]> {
  const rows = await db.location.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      type: true,
      code: true,
      parentId: true,
      _count: { select: { assets: { where: { deletedAt: null } } } },
    },
    orderBy: { name: "asc" },
  });
  const byParent = new Map<string | null, typeof rows>();
  for (const r of rows) {
    const k = r.parentId && rows.some((x) => x.id === r.parentId) ? r.parentId : null;
    byParent.set(k, [...(byParent.get(k) ?? []), r]);
  }
  const out: LocationNode[] = [];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      const path = prefix ? `${prefix} › ${r.name}` : r.name;
      out.push({ id: r.id, name: r.name, type: r.type, code: r.code, parentId: r.parentId, path, depth, assetCount: r._count.assets });
      if (depth < 20) walk(r.id, path, depth + 1);
    }
  };
  walk(null, "", 0);
  return out;
}

export async function locationPath(tx: Tx | typeof db, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const rows = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`
    WITH RECURSIVE up AS (
      SELECT id, name, "parentId", 0 AS lvl FROM "Location" WHERE id = ${id}
      UNION ALL
      SELECT l.id, l.name, l."parentId", up.lvl + 1 FROM "Location" l JOIN up ON l.id = up."parentId" WHERE up.lvl < 20
    ) SELECT name FROM up ORDER BY lvl DESC`);
  return rows.map((r) => r.name).join(" › ") || null;
}

/** IDs of a location and everything beneath it (for "assets in this building" filters). */
export async function descendantIds(id: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH RECURSIVE down AS (
      SELECT id, 0 AS lvl FROM "Location" WHERE id = ${id}
      UNION ALL
      SELECT l.id, down.lvl + 1 FROM "Location" l JOIN down ON l."parentId" = down.id
      WHERE l."deletedAt" IS NULL AND down.lvl < 20
    ) SELECT id FROM down`);
  return rows.map((r) => r.id);
}

export async function getLocation(id: string) {
  const loc = await db.location.findFirst({
    where: { id, deletedAt: null },
    include: { parent: true, children: { where: { deletedAt: null }, orderBy: { name: "asc" } } },
  });
  if (!loc) throw new NotFoundError("Location");
  return loc;
}

async function assertNoCycle(id: string, parentId: string | undefined) {
  if (!parentId) return;
  if (parentId === id) throw new AppError("A location cannot be its own parent.");
  if ((await descendantIds(id)).includes(parentId)) throw new AppError("Cannot move a location under one of its own children.");
}

export async function createLocation(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "locations", "write");
  const data = locationInput.parse(input);
  return db.$transaction(async (tx) => {
    const loc = await tx.location.create({ data: { ...data, parentId: data.parentId ?? null } });
    await audit(tx, ctx, { action: "create", entityType: "Location", entityId: loc.id, summary: `Created location ${loc.name}`, after: loc });
    return loc;
  });
}

export async function updateLocation(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "locations", "write");
  const data = locationInput.parse(input);
  await assertNoCycle(id, data.parentId);
  return db.$transaction(async (tx) => {
    const before = await tx.location.findUniqueOrThrow({ where: { id } });
    const after = await tx.location.update({
      where: { id },
      data: { ...data, code: data.code ?? null, parentId: data.parentId ?? null, address: data.address ?? null, notes: data.notes ?? null },
    });
    const d = diff(before, after);
    if (d.changed.length)
      await audit(tx, ctx, { action: "update", entityType: "Location", entityId: id, summary: `Updated location ${after.name}`, before: d.before, after: d.after });
    return after;
  });
}

export async function deleteLocation(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "locations", "write");
  const [children, assets] = await Promise.all([
    db.location.count({ where: { parentId: id, deletedAt: null } }),
    db.asset.count({ where: { locationId: id, deletedAt: null } }),
  ]);
  if (children || assets)
    throw new AppError(`Location still has ${children} sub-location(s) and ${assets} asset(s). Move them first.`);
  await db.$transaction(async (tx) => {
    const loc = await tx.location.update({ where: { id }, data: { deletedAt: new Date(), code: null } });
    await audit(tx, ctx, { action: "delete", entityType: "Location", entityId: id, summary: `Deleted location ${loc.name}` });
  });
}
