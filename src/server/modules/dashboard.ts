import "server-only";
import { db } from "../db";
import { assertCan } from "../rbac/permissions";
import type { Ctx } from "../context";

const DAY = 86_400_000;

export async function dashboardData(ctx: Ctx) {
  assertCan(ctx.user.role, "assets", "read");
  const now = new Date();
  const in90 = new Date(now.getTime() + 90 * DAY);
  const in30 = new Date(now.getTime() + 30 * DAY);
  const live = { deletedAt: null, status: { notIn: ["DISPOSED" as const, "RETIRED" as const] } };

  const [byStatus, total, warranty, pmDue, overdue, recent, phi, locations] = await Promise.all([
    db.asset.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    db.asset.count({ where: { deletedAt: null } }),
    db.asset.findMany({
      where: { ...live, warrantyEnd: { gte: now, lte: in90 } },
      select: { id: true, tag: true, name: true, warrantyEnd: true },
      orderBy: { warrantyEnd: "asc" },
      take: 10,
    }),
    db.asset.findMany({
      where: { ...live, nextPmDate: { lte: in30 } },
      select: { id: true, tag: true, name: true, nextPmDate: true },
      orderBy: { nextPmDate: "asc" },
      take: 10,
    }),
    db.checkout.findMany({
      where: { returnedAt: null, dueAt: { lt: now } },
      include: { asset: { select: { id: true, tag: true, name: true } }, person: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    db.assetMovement.findMany({
      include: { asset: { select: { id: true, tag: true, name: true } } },
      orderBy: { movedAt: "desc" },
      take: 10,
    }),
    db.asset.count({ where: { ...live, storesPhi: true } }),
    db.location.count({ where: { deletedAt: null } }),
  ]);

  return {
    total,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<string, number>,
    warranty,
    pmDue,
    overdue,
    recent,
    phi,
    locations,
  };
}
