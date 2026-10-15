import { api, paging } from "@/server/api/handler";
import { assertCan } from "@/server/rbac/permissions";
import { db } from "@/server/db";

/** People (staff). Filters: q (name, email, employee ID), active=true|false; page, pageSize. */
export const GET = api("people", "read", async ({ ctx, url }) => {
  assertCan(ctx.user.role, "people", "read");
  const { page, pageSize, skip } = paging(url);
  const q = url.searchParams.get("q")?.trim();
  const active = url.searchParams.get("active");
  const ci = { contains: q ?? "", mode: "insensitive" as const };
  const where = {
    deletedAt: null,
    ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
    ...(q ? { OR: [{ name: ci }, { email: ci }, { employeeId: ci }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.person.findMany({ where, include: { department: { select: { name: true } } }, orderBy: { name: "asc" }, take: pageSize, skip }),
    db.person.count({ where }),
  ]);
  return {
    data: rows.map((p) => ({ id: p.id, name: p.name, email: p.email, employeeId: p.employeeId, title: p.title, phone: p.phone, department: p.department?.name ?? null, active: p.active })),
    page,
    pageSize,
    total,
  };
});
