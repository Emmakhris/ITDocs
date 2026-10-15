import "server-only";
import { z } from "zod";
import { ChangeRisk, ChangeStatus, ChangeType, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { optDate, optStr } from "../lib/forms";
import { changeEditable, changeNo, decisionBlocker, incidentNo, missingForSubmit, nextChangeStatus, windowsOverlap, type ChangeAction } from "../lib/workflow";
import type { Ctx } from "../context";

// Change records with an approval workflow (rules in lib/workflow.ts), planned windows with clash
// warnings, and affected assets. Every transition is audited with who did it and why.

const longText = (max = 20_000) => z.string().max(max).default("");

export const changeInput = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: longText(),
    type: z.nativeEnum(ChangeType).default("NORMAL"),
    risk: z.nativeEnum(ChangeRisk).default("MEDIUM"),
    impact: optStr(1000),
    implementationPlan: longText(),
    rollbackPlan: longText(),
    testPlan: longText(),
    plannedStart: optDate,
    plannedEnd: optDate,
    ticketRef: optStr(60),
  })
  .refine((c) => !c.plannedStart || !c.plannedEnd || c.plannedEnd > c.plannedStart, { path: ["plannedEnd"], message: "The window must end after it starts" });

export type ChangeView = "open" | "upcoming" | "recent" | "all";
const OPEN: ChangeStatus[] = ["DRAFT", "SUBMITTED", "APPROVED", "IN_PROGRESS"];
const LIVE: ChangeStatus[] = ["SUBMITTED", "APPROVED", "IN_PROGRESS"];

export async function listChanges(ctx: Ctx, f: { q?: string; status?: ChangeStatus; view?: ChangeView } = {}) {
  assertCan(ctx.user.role, "changes", "read");
  const and: Prisma.ChangeRequestWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  else if (f.view === "open" || !f.view) and.push({ status: { in: OPEN } });
  else if (f.view === "upcoming") and.push({ status: { in: ["SUBMITTED", "APPROVED"] }, plannedStart: { gte: new Date() } });
  else if (f.view === "recent") and.push({ updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } });
  if (f.q?.trim()) {
    const q = f.q.trim();
    const n = /^\s*(?:chg-?)?0*(\d{1,9})\s*$/i.exec(q);
    and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { ticketRef: { contains: q, mode: "insensitive" } }, ...(n ? [{ number: Number(n[1]) }] : [])] });
  }
  return db.changeRequest.findMany({
    where: { AND: and },
    select: { id: true, number: true, title: true, type: true, risk: true, status: true, plannedStart: true, plannedEnd: true, requesterName: true, approverName: true, updatedAt: true },
    orderBy: f.view === "recent" || f.view === "all" ? [{ updatedAt: "desc" }] : [{ plannedStart: { sort: "asc", nulls: "last" } }, { number: "desc" }],
    take: 300,
  });
}

/** Changes scheduled to start in the next `days` days (for the dashboard and calendar). */
export async function upcomingChanges(ctx: Ctx, days = 7) {
  if (!can(ctx.user.role, "changes", "read")) return [];
  return db.changeRequest.findMany({
    where: { status: { in: LIVE }, plannedEnd: { gte: new Date() }, plannedStart: { lte: new Date(Date.now() + days * 86_400_000) } },
    select: { id: true, number: true, title: true, risk: true, status: true, plannedStart: true, plannedEnd: true },
    orderBy: { plannedStart: "asc" },
  });
}

export async function getChange(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "changes", "read");
  const c = await db.changeRequest.findUnique({
    where: { id },
    include: { incidents: { select: { id: true, number: true, title: true, severity: true, status: true } } },
  });
  if (!c) throw new NotFoundError("Change");
  const [links, clashes] = await Promise.all([
    db.entityLink.findMany({ where: { fromType: "Change", fromId: id, toType: "Asset", kind: "affects" }, select: { toId: true } }),
    c.plannedStart && c.plannedEnd && OPEN.includes(c.status)
      ? db.changeRequest.findMany({
          where: { id: { not: id }, status: { in: LIVE }, plannedStart: { lt: c.plannedEnd }, plannedEnd: { gt: c.plannedStart } },
          select: { id: true, number: true, title: true, plannedStart: true, plannedEnd: true, status: true },
        })
      : [],
  ]);
  const assets = can(ctx.user.role, "assets", "read")
    ? await db.asset.findMany({ where: { id: { in: links.map((l) => l.toId) } }, select: { id: true, tag: true, name: true, status: true }, orderBy: { tag: "asc" } })
    : [];
  // Clashes that touch the same assets are the ones that matter most
  const shared = clashes.length
    ? await db.entityLink.findMany({ where: { fromType: "Change", fromId: { in: clashes.map((x) => x.id) }, toType: "Asset", kind: "affects", toId: { in: links.map((l) => l.toId) } }, select: { fromId: true } })
    : [];
  return {
    ...c,
    assets,
    clashes: clashes
      .filter((x) => windowsOverlap({ start: c.plannedStart!, end: c.plannedEnd! }, { start: x.plannedStart!, end: x.plannedEnd! }))
      .map((x) => ({ ...x, sharesAssets: shared.some((s) => s.fromId === x.id) })),
    history: await db.auditLog.findMany({ where: { entityType: "ChangeRequest", entityId: id }, orderBy: { at: "asc" }, select: { id: true, at: true, actorName: true, action: true, summary: true } }),
  };
}

export async function createChange(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "changes", "write");
  const d = changeInput.parse(input);
  return db.$transaction(async (tx) => {
    const c = await tx.changeRequest.create({
      data: { ...d, impact: d.impact ?? null, plannedStart: d.plannedStart ?? null, plannedEnd: d.plannedEnd ?? null, ticketRef: d.ticketRef ?? null, requesterId: ctx.user.id, requesterName: ctx.user.displayName },
    });
    await audit(tx, ctx, { action: "create", entityType: "ChangeRequest", entityId: c.id, summary: `Created ${changeNo(c.number)} "${c.title}" (${c.type.toLowerCase()}, ${c.risk.toLowerCase()} risk)` });
    return c;
  });
}

export async function updateChange(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "changes", "write");
  const d = changeInput.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.changeRequest.findUnique({ where: { id } });
    if (!before) throw new NotFoundError("Change");
    if (!changeEditable(before.status)) throw new AppError(`A ${before.status.toLowerCase().replace("_", " ")} change can't be edited.${before.status === "REJECTED" ? " Reopen it first." : ""}`);
    const backToDraft = before.status === "SUBMITTED";
    const after = await tx.changeRequest.update({
      where: { id },
      data: { ...d, impact: d.impact ?? null, plannedStart: d.plannedStart ?? null, plannedEnd: d.plannedEnd ?? null, ticketRef: d.ticketRef ?? null, ...(backToDraft ? { status: "DRAFT" as const } : {}) },
    });
    const df = diff(before, after);
    if (df.changed.length)
      await audit(tx, ctx, {
        action: "update",
        entityType: "ChangeRequest",
        entityId: id,
        summary: `Edited ${changeNo(after.number)}${backToDraft ? " — returned to draft for resubmission" : ""}`,
        before: df.before,
        after: df.after,
      });
    return after;
  });
}

const ACTION_VERB: Record<ChangeAction, string> = {
  submit: "Submitted for approval",
  approve: "Approved",
  reject: "Rejected",
  start: "Started",
  complete: "Completed",
  fail: "Marked failed",
  rollback: "Rolled back",
  cancel: "Cancelled",
  reopen: "Reopened",
};

/** Moves a change through its workflow. `note` is required when rejecting, failing or rolling back. */
export async function transitionChange(ctx: Ctx, id: string, action: ChangeAction, note?: string) {
  assertCan(ctx.user.role, "changes", "write");
  const text = note?.trim().slice(0, 2000) || undefined;
  return db.$transaction(async (tx) => {
    const c = await tx.changeRequest.findUnique({ where: { id } });
    if (!c) throw new NotFoundError("Change");
    const to = nextChangeStatus(c, action);
    if (!to) throw new AppError(`Can't ${action} a ${c.type.toLowerCase()} change that is ${c.status.toLowerCase().replace("_", " ")}.`);
    if (action === "approve" || action === "reject") {
      const blocked = decisionBlocker(c, ctx.user);
      if (blocked) throw new AppError(blocked, 403);
    }
    if (action === "submit" || (action === "start" && c.status !== "APPROVED")) {
      const missing = missingForSubmit(c);
      if (missing.length) throw new AppError(`Add the ${missing.join(", ")} first.`);
    }
    if ((action === "reject" || action === "fail" || action === "rollback") && !text) throw new FieldError({ note: "Say why — it goes on the record." });

    const now = new Date();
    const data: Prisma.ChangeRequestUpdateInput = { status: to };
    if (action === "approve" || action === "reject") Object.assign(data, { approver: { connect: { id: ctx.user.id } }, approverName: ctx.user.displayName, decidedAt: now, decisionNote: text ?? null });
    if (action === "start") data.actualStart = now;
    if (action === "complete" || action === "fail" || action === "rollback") Object.assign(data, { actualEnd: now, outcomeNote: text ?? null });
    if (action === "reopen") Object.assign(data, { approver: { disconnect: true }, approverName: null, decidedAt: null, decisionNote: null });

    // Only apply if nobody moved it in the meantime
    const res = await tx.changeRequest.updateMany({ where: { id, status: c.status }, data: { status: to } });
    if (!res.count) throw new AppError("This change was updated by someone else. Reload and try again.", 409);
    const after = await tx.changeRequest.update({ where: { id }, data });
    const retro = action === "approve" && to !== "APPROVED";
    await audit(tx, ctx, {
      action: `change_${action}`,
      entityType: "ChangeRequest",
      entityId: id,
      summary: `${ACTION_VERB[action]}${retro ? " (retrospectively)" : ""} ${changeNo(c.number)}${text ? `: ${text}` : ""}`,
      before: { status: c.status },
      after: { status: after.status },
    });
    return after;
  });
}

// ───────────────────────────── Affected assets ─────────────────────────────

/** Shared by changes and incidents: links an asset as affected. */
export async function linkAffected(ctx: Ctx, fromType: "Change" | "Incident", fromId: string, assetId: string) {
  assertCan(ctx.user.role, "changes", "write");
  const label = fromType === "Change" ? (await db.changeRequest.findUnique({ where: { id: fromId }, select: { number: true } }).then((x) => x && changeNo(x.number))) : (await db.incident.findUnique({ where: { id: fromId }, select: { number: true } }).then((x) => x && incidentNo(x.number)));
  if (!label) throw new NotFoundError(fromType);
  const asset = await db.asset.findFirst({ where: { id: assetId, deletedAt: null }, select: { tag: true } });
  if (!asset) throw new FieldError({ assetId: "Asset not found" });
  await db.$transaction(async (tx) => {
    const key = { fromType, fromId, toType: "Asset", toId: assetId, kind: "affects" };
    if (await tx.entityLink.findUnique({ where: { fromType_fromId_toType_toId_kind: key } })) return;
    await tx.entityLink.create({ data: key });
    await audit(tx, ctx, { action: "link", entityType: fromType === "Change" ? "ChangeRequest" : "Incident", entityId: fromId, summary: `${label} affects ${asset.tag}` });
  });
}

export async function unlinkAffected(ctx: Ctx, fromType: "Change" | "Incident", fromId: string, assetId: string) {
  assertCan(ctx.user.role, "changes", "write");
  await db.$transaction(async (tx) => {
    const r = await tx.entityLink.deleteMany({ where: { fromType, fromId, toType: "Asset", toId: assetId, kind: "affects" } });
    if (r.count) await audit(tx, ctx, { action: "unlink", entityType: fromType === "Change" ? "ChangeRequest" : "Incident", entityId: fromId, summary: `Removed affected asset ${assetId}` });
  });
}

/** Changes and incidents that list an asset as affected (newest first), for the asset page. */
export async function recordsForAsset(ctx: Ctx, assetId: string) {
  if (!can(ctx.user.role, "changes", "read")) return { changes: [], incidents: [] };
  const links = await db.entityLink.findMany({ where: { toType: "Asset", toId: assetId, kind: "affects", fromType: { in: ["Change", "Incident"] } }, select: { fromType: true, fromId: true } });
  const ids = (t: string) => links.filter((l) => l.fromType === t).map((l) => l.fromId);
  const [changes, incidents] = await Promise.all([
    db.changeRequest.findMany({ where: { id: { in: ids("Change") } }, select: { id: true, number: true, title: true, status: true, plannedStart: true }, orderBy: { number: "desc" }, take: 20 }),
    db.incident.findMany({ where: { id: { in: ids("Incident") } }, select: { id: true, number: true, title: true, status: true, severity: true, startedAt: true }, orderBy: { number: "desc" }, take: 20 }),
  ]);
  return { changes, incidents };
}

export async function changeOptions() {
  return db.changeRequest.findMany({ select: { id: true, number: true, title: true }, orderBy: { number: "desc" }, take: 200 });
}
