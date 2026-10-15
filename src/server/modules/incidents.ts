import "server-only";
import { z } from "zod";
import { IncidentSeverity, IncidentStatus, Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { optDate, optStr } from "../lib/forms";
import { incidentNo, incidentOpen, incidentStatusChange } from "../lib/workflow";
import { notifyIncident } from "./alerts";
import type { Ctx } from "../context";

// Incident records with an append-only timeline, severity, owner, root cause and resolution,
// optionally linked to the change that caused them. Status rules live in lib/workflow.ts.

export const incidentInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(20_000).default(""),
  severity: z.nativeEnum(IncidentSeverity).default("P3"),
  impact: optStr(1000),
  startedAt: optDate,
  ownerId: optStr(40),
  causedByChangeId: optStr(40),
  ticketRef: optStr(60),
  rootCause: optStr(10_000),
  resolution: optStr(10_000),
  followUp: optStr(10_000),
});

const OPEN: IncidentStatus[] = ["OPEN", "INVESTIGATING", "MITIGATED"];

export async function listIncidents(ctx: Ctx, f: { q?: string; view?: "open" | "recent" | "all"; severity?: IncidentSeverity } = {}) {
  assertCan(ctx.user.role, "changes", "read");
  const and: Prisma.IncidentWhereInput[] = [];
  if (!f.view || f.view === "open") and.push({ status: { in: OPEN } });
  if (f.view === "recent") and.push({ startedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } });
  if (f.severity) and.push({ severity: f.severity });
  if (f.q?.trim()) {
    const q = f.q.trim();
    const n = /^\s*(?:inc-?)?0*(\d{1,9})\s*$/i.exec(q);
    and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { ticketRef: { contains: q, mode: "insensitive" } }, { rootCause: { contains: q, mode: "insensitive" } }, ...(n ? [{ number: Number(n[1]) }] : [])] });
  }
  return db.incident.findMany({
    where: { AND: and },
    select: { id: true, number: true, title: true, severity: true, status: true, startedAt: true, mitigatedAt: true, resolvedAt: true, owner: { select: { displayName: true } } },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { startedAt: "desc" }],
    take: 300,
  });
}

/** Open incidents, most severe first (dashboard). */
export async function openIncidents(ctx: Ctx) {
  if (!can(ctx.user.role, "changes", "read")) return [];
  return db.incident.findMany({
    where: { status: { in: OPEN } },
    select: { id: true, number: true, title: true, severity: true, status: true, startedAt: true },
    orderBy: [{ severity: "asc" }, { startedAt: "asc" }],
  });
}

export async function getIncident(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "changes", "read");
  const i = await db.incident.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, displayName: true } },
      causedByChange: { select: { id: true, number: true, title: true, status: true } },
      updates: { orderBy: { at: "asc" } },
    },
  });
  if (!i) throw new NotFoundError("Incident");
  const links = await db.entityLink.findMany({ where: { fromType: "Incident", fromId: id, toType: "Asset", kind: "affects" }, select: { toId: true } });
  const assets = can(ctx.user.role, "assets", "read")
    ? await db.asset.findMany({ where: { id: { in: links.map((l) => l.toId) } }, select: { id: true, tag: true, name: true, status: true }, orderBy: { tag: "asc" } })
    : [];
  return { ...i, assets };
}

async function checkRefs(d: { ownerId?: string; causedByChangeId?: string }) {
  if (d.ownerId && !(await db.user.findFirst({ where: { id: d.ownerId, active: true } }))) throw new FieldError({ ownerId: "User not found" });
  if (d.causedByChangeId && !(await db.changeRequest.findUnique({ where: { id: d.causedByChangeId } }))) throw new FieldError({ causedByChangeId: "Change not found" });
}

const note = (tx: Tx, ctx: Ctx, incidentId: string, kind: string, text: string) =>
  tx.incidentUpdate.create({ data: { incidentId, kind, text, authorId: ctx.user.id, authorName: ctx.user.displayName } });

export async function createIncident(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "changes", "write");
  const d = incidentInput.parse(input);
  await checkRefs(d);
  if (d.startedAt && d.startedAt.getTime() > Date.now() + 5 * 60_000) throw new FieldError({ startedAt: "Can't start in the future" });
  const created = await db.$transaction(async (tx) => {
    const i = await tx.incident.create({
      data: {
        title: d.title,
        description: d.description,
        severity: d.severity,
        impact: d.impact ?? null,
        startedAt: d.startedAt ?? new Date(),
        ownerId: d.ownerId ?? ctx.user.id,
        causedByChangeId: d.causedByChangeId ?? null,
        ticketRef: d.ticketRef ?? null,
        createdBy: ctx.user.displayName,
      },
    });
    await note(tx, ctx, i.id, "status", `Incident opened (${i.severity})`);
    await audit(tx, ctx, { action: "create", entityType: "Incident", entityId: i.id, summary: `Opened ${incidentNo(i.number)} "${i.title}" (${i.severity})` });
    return i;
  });
  // After commit, so a slow mail server never holds up or rolls back the incident
  await notifyIncident(created.id, "opened");
  return created;
}

export async function updateIncident(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "changes", "write");
  const d = incidentInput.parse(input);
  await checkRefs(d);
  let escalated = false;
  const updated = await db.$transaction(async (tx) => {
    const before = await tx.incident.findUnique({ where: { id }, include: { owner: { select: { displayName: true } } } });
    if (!before) throw new NotFoundError("Incident");
    const after = await tx.incident.update({
      where: { id },
      data: {
        title: d.title,
        description: d.description,
        severity: d.severity,
        impact: d.impact ?? null,
        startedAt: d.startedAt ?? before.startedAt,
        ownerId: d.ownerId ?? null,
        causedByChangeId: d.causedByChangeId ?? null,
        ticketRef: d.ticketRef ?? null,
        rootCause: d.rootCause ?? null,
        resolution: d.resolution ?? null,
        followUp: d.followUp ?? null,
      },
      include: { owner: { select: { displayName: true } } },
    });
    // Severity and owner changes belong on the timeline, not just the audit log
    if (before.severity !== after.severity) {
      await note(tx, ctx, id, "severity", `Severity changed ${before.severity} → ${after.severity}`);
      // P4 → P1 is "higher": enum order is P1 < P2 < P3 < P4
      escalated = after.severity < before.severity && (after.severity === "P1" || after.severity === "P2");
    }
    if (before.ownerId !== after.ownerId) await note(tx, ctx, id, "owner", `Owner changed to ${after.owner?.displayName ?? "nobody"}`);
    const { owner: _o, ...b } = before;
    const { owner: _a, ...a } = after;
    const df = diff(b, a);
    if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "Incident", entityId: id, summary: `Updated ${incidentNo(after.number)} (${df.changed.join(", ")})`, before: df.before, after: df.after });
    return after;
  });
  if (escalated) await notifyIncident(id, "escalated");
  return updated;
}

export async function addIncidentUpdate(ctx: Ctx, id: string, text: string) {
  assertCan(ctx.user.role, "changes", "write");
  const t = text.trim();
  if (!t) throw new FieldError({ text: "Write an update" });
  if (t.length > 5000) throw new FieldError({ text: "Keep updates under 5,000 characters" });
  return db.$transaction(async (tx) => {
    const i = await tx.incident.findUnique({ where: { id }, select: { number: true } });
    if (!i) throw new NotFoundError("Incident");
    const u = await note(tx, ctx, id, "note", t);
    await audit(tx, ctx, { action: "comment", entityType: "Incident", entityId: id, summary: `Update on ${incidentNo(i.number)}` });
    return u;
  });
}

export async function setIncidentStatus(ctx: Ctx, id: string, to: IncidentStatus, comment?: string) {
  assertCan(ctx.user.role, "changes", "write");
  return db.$transaction(async (tx) => {
    const i = await tx.incident.findUnique({ where: { id } });
    if (!i) throw new NotFoundError("Incident");
    const r = incidentStatusChange(i, to);
    if ("error" in r) throw new AppError(r.error);
    const res = await tx.incident.updateMany({ where: { id, status: i.status }, data: { status: to, ...r.set } });
    if (!res.count) throw new AppError("This incident was updated by someone else. Reload and try again.", 409);
    const reopened = !incidentOpen(i.status) && incidentOpen(to);
    await note(tx, ctx, id, "status", `${reopened ? "Reopened" : "Status"}: ${i.status.toLowerCase()} → ${to.toLowerCase()}${comment?.trim() ? ` — ${comment.trim().slice(0, 1000)}` : ""}`);
    await audit(tx, ctx, { action: "status", entityType: "Incident", entityId: id, summary: `${incidentNo(i.number)} ${i.status} → ${to}`, before: { status: i.status }, after: { status: to } });
    return tx.incident.findUniqueOrThrow({ where: { id } });
  });
}

/** Active users who can own an incident (anyone who can write to changes & incidents). */
export async function ownerOptions() {
  const users = await db.user.findMany({ where: { active: true, role: { in: ["ADMIN", "TECHNICIAN"] } }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } });
  return users;
}
