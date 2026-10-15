import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError } from "../lib/errors";
import { checkbox, optStr } from "../lib/forms";
import { fieldDefsSchema, parseFieldDefs } from "../lib/custom-fields";
import type { Ctx } from "../context";

export const assetTypeInput = z.object({
  name: z.string().trim().min(1).max(80),
  icon: optStr(40),
  tagPrefix: optStr(10),
  isMedical: checkbox,
  fieldDefs: z
    .string()
    .optional()
    .transform((s, c) => {
      try {
        return s ? JSON.parse(s) : [];
      } catch {
        c.addIssue({ code: "custom", message: "Invalid field definitions" });
        return z.NEVER;
      }
    })
    .pipe(fieldDefsSchema),
});

export async function listAssetTypes() {
  const rows = await db.assetType.findMany({
    where: { deletedAt: null },
    include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ ...r, fieldDefs: parseFieldDefs(r.fieldDefs) }));
}

export async function getAssetType(id: string) {
  const t = await db.assetType.findFirstOrThrow({ where: { id, deletedAt: null } });
  return { ...t, fieldDefs: parseFieldDefs(t.fieldDefs) };
}

export async function saveAssetType(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "admin", "write");
  const data = assetTypeInput.parse(input);
  const row = { ...data, icon: data.icon ?? null, tagPrefix: data.tagPrefix ?? null };
  return db.$transaction(async (tx) => {
    if (!id) {
      const t = await tx.assetType.create({ data: row });
      await audit(tx, ctx, { action: "create", entityType: "AssetType", entityId: t.id, summary: `Created asset type ${t.name}`, after: t });
      return t;
    }
    const before = await tx.assetType.findUniqueOrThrow({ where: { id } });
    const after = await tx.assetType.update({ where: { id }, data: row });
    const d = diff(before, after);
    if (d.changed.length)
      await audit(tx, ctx, { action: "update", entityType: "AssetType", entityId: id, summary: `Updated asset type ${after.name}`, before: d.before, after: d.after });
    return after;
  });
}

export async function deleteAssetType(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "admin", "write");
  const n = await db.asset.count({ where: { typeId: id, deletedAt: null } });
  if (n) throw new AppError(`${n} asset(s) still use this type.`);
  await db.$transaction(async (tx) => {
    const before = await tx.assetType.findUniqueOrThrow({ where: { id } });
    // Free the unique name so it can be reused
    await tx.assetType.update({ where: { id }, data: { deletedAt: new Date(), name: `${before.name} (deleted ${id})` } });
    await audit(tx, ctx, { action: "delete", entityType: "AssetType", entityId: id, summary: `Deleted asset type ${before.name}` });
  });
}
