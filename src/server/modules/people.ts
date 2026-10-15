import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { NotFoundError } from "../lib/errors";
import { optStr, checkbox } from "../lib/forms";
import type { Ctx } from "../context";

export const personInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.union([z.literal(""), z.email("Invalid email")]).optional(),
  employeeId: optStr(40),
  phone: optStr(40),
  title: optStr(120),
  departmentId: optStr(40),
  active: checkbox,
});

export async function listPeople(opts: { q?: string; departmentId?: string; take?: number; skip?: number } = {}) {
  const where = {
    deletedAt: null,
    ...(opts.departmentId ? { departmentId: opts.departmentId } : {}),
    ...(opts.q
      ? {
          OR: [
            { name: { contains: opts.q, mode: "insensitive" as const } },
            { email: { contains: opts.q, mode: "insensitive" as const } },
            { employeeId: { contains: opts.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.person.findMany({
      where,
      include: { department: true, _count: { select: { assets: { where: { deletedAt: null } } } } },
      orderBy: { name: "asc" },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
    }),
    db.person.count({ where }),
  ]);
  return { rows, total };
}

export async function getPerson(id: string) {
  const p = await db.person.findFirst({
    where: { id, deletedAt: null },
    include: {
      department: true,
      assets: { where: { deletedAt: null }, include: { type: true, location: true }, orderBy: { tag: "asc" } },
      checkouts: { include: { asset: true }, orderBy: { outAt: "desc" }, take: 50 },
    },
  });
  if (!p) throw new NotFoundError("Person");
  return p;
}

const clean = (d: z.infer<typeof personInput>) => ({
  name: d.name,
  email: d.email || null,
  employeeId: d.employeeId ?? null,
  phone: d.phone ?? null,
  title: d.title ?? null,
  departmentId: d.departmentId ?? null,
  active: d.active,
});

export async function createPerson(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "people", "write");
  const data = clean(personInput.parse({ active: "on", ...(input as object) }));
  return db.$transaction(async (tx) => {
    const p = await tx.person.create({ data });
    await audit(tx, ctx, { action: "create", entityType: "Person", entityId: p.id, summary: `Added person ${p.name}`, after: p });
    return p;
  });
}

export async function updatePerson(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "people", "write");
  const data = clean(personInput.parse(input));
  return db.$transaction(async (tx) => {
    const before = await tx.person.findUniqueOrThrow({ where: { id } });
    const after = await tx.person.update({ where: { id }, data });
    const d = diff(before, after);
    if (d.changed.length)
      await audit(tx, ctx, { action: "update", entityType: "Person", entityId: id, summary: `Updated ${after.name}`, before: d.before, after: d.after });
    return after;
  });
}

export async function listDepartments() {
  return db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
}

export async function createDepartment(ctx: Ctx, name: string, costCenter?: string) {
  assertCan(ctx.user.role, "people", "write");
  const n = z.string().trim().min(1).max(120).parse(name);
  return db.$transaction(async (tx) => {
    const d = await tx.department.create({ data: { name: n, costCenter: costCenter || null } });
    await audit(tx, ctx, { action: "create", entityType: "Department", entityId: d.id, summary: `Added department ${d.name}` });
    return d;
  });
}
