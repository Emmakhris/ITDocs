import { NextResponse } from "next/server";
import type { AssetStatus } from "@prisma/client";
import { getCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { assetWhere } from "@/server/modules/assets";
import { audit } from "@/server/audit/log";
import { db } from "@/server/db";
import { csvResponse } from "@/server/lib/csv";
import { parseFieldDefs } from "@/server/lib/custom-fields";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || !can(ctx.user.role, "assets", "read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const where = await assetWhere({
    q: sp.get("q") ?? undefined,
    status: (sp.get("status") as AssetStatus) || undefined,
    typeId: sp.get("typeId") ?? undefined,
    locationId: sp.get("locationId") ?? undefined,
    phi: sp.get("phi") === "1",
    medical: sp.get("medical") === "1",
    warrantyBefore: sp.get("warranty") ? new Date(Date.now() + Number(sp.get("warranty")) * 86_400_000) : undefined,
  });
  await audit(db, ctx, { action: "export", entityType: "Asset", summary: `Exported assets to CSV (${sp.toString() || "all"})` });

  // Include every custom field key used by any type, prefixed cf_
  const types = await db.assetType.findMany({ where: { deletedAt: null } });
  const cfKeys = [...new Set(types.flatMap((t) => parseFieldDefs(t.fieldDefs).map((d) => d.key)))].sort();
  const header = [
    "tag", "name", "type", "status", "manufacturer", "model", "serial", "hostname", "ipAddress", "macAddress", "os",
    "location", "assignee", "assigneeEmail", "department", "vendorName", "poNumber", "purchaseDate", "purchaseCost",
    "warrantyEnd", "eolDate", "storesPhi", "udi", "riskClass", "lastPmDate", "nextPmDate", "notes",
    ...cfKeys.map((k) => `cf_${k}`),
  ];
  const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";

  async function* rows() {
    let cursor: string | undefined;
    const paths = new Map((await db.location.findMany({ select: { id: true, name: true, parentId: true } })).map((l) => [l.id, l]));
    const pathOf = (id: string | null) => {
      const parts: string[] = [];
      let cur = id ? paths.get(id) : undefined;
      for (let i = 0; cur && i < 20; i++) {
        parts.unshift(cur.name);
        cur = cur.parentId ? paths.get(cur.parentId) : undefined;
      }
      return parts.join(" › ");
    };
    for (;;) {
      const batch = await db.asset.findMany({
        where,
        include: { type: true, assignee: true, department: true },
        orderBy: { id: "asc" },
        take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) return;
      for (const a of batch) {
        const cf = a.customFields as Record<string, unknown>;
        yield [
          a.tag, a.name, a.type.name, a.status, a.manufacturer, a.model, a.serial, a.hostname, a.ipAddress, a.macAddress, a.os,
          pathOf(a.locationId), a.assignee?.name, a.assignee?.email, a.department?.name, a.vendorName, a.poNumber,
          day(a.purchaseDate), a.purchaseCost?.toString(), day(a.warrantyEnd), day(a.eolDate), a.storesPhi ? "yes" : "no",
          a.udi, a.riskClass, day(a.lastPmDate), day(a.nextPmDate), a.notes,
          ...cfKeys.map((k) => cf[k]),
        ];
      }
      cursor = batch[batch.length - 1].id;
    }
  }
  return csvResponse(`assets-${new Date().toISOString().slice(0, 10)}.csv`, header, rows());
}
