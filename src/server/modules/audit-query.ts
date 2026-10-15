import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { assertCan } from "../rbac/permissions";
import type { Ctx } from "../context";

export type AuditFilter = {
  q?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  actor?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

function where(f: AuditFilter): Prisma.AuditLogWhereInput {
  return {
    ...(f.action ? { action: f.action } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.actor ? { actorName: { contains: f.actor, mode: "insensitive" } } : {}),
    ...(f.q ? { summary: { contains: f.q, mode: "insensitive" } } : {}),
    ...(f.from || f.to ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

export async function queryAudit(ctx: Ctx, f: AuditFilter) {
  assertCan(ctx.user.role, "audit", "read");
  const pageSize = Math.min(f.pageSize ?? 100, 500);
  const page = Math.max(f.page ?? 1, 1);
  const w = where(f);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where: w, orderBy: { at: "desc" }, take: pageSize, skip: (page - 1) * pageSize }),
    db.auditLog.count({ where: w }),
  ]);
  return { rows, total, page, pageSize };
}

/** Change history of one record — shown on detail pages to anyone who can read the record. */
export async function entityHistory(entityType: string, entityId: string, take = 50) {
  return db.auditLog.findMany({ where: { entityType, entityId }, orderBy: { at: "desc" }, take });
}

export async function auditFacets() {
  const [actions, types] = await Promise.all([
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    db.auditLog.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
  ]);
  return { actions: actions.map((a) => a.action), entityTypes: types.map((t) => t.entityType) };
}

export async function* auditCsvRows(ctx: Ctx, f: AuditFilter) {
  assertCan(ctx.user.role, "audit", "read");
  const w = where(f);
  let cursor: bigint | undefined;
  for (;;) {
    const batch = await db.auditLog.findMany({
      where: w,
      orderBy: { id: "desc" },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!batch.length) return;
    for (const r of batch) yield r;
    cursor = batch[batch.length - 1].id;
  }
}
