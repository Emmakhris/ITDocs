/** Change and incident workflow rules. Pure functions so they're easy to test and to show in the UI. */
import type { ChangeRisk, ChangeStatus, ChangeType, IncidentSeverity, IncidentStatus, Role } from "@prisma/client";

// ───────────────────────────── Changes ─────────────────────────────

export const CHANGE_ACTIONS = ["submit", "approve", "reject", "start", "complete", "fail", "rollback", "cancel", "reopen"] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

type ChangeLike = {
  status: ChangeStatus;
  type: ChangeType;
  risk: ChangeRisk;
  requesterId: string | null;
  approverId: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  implementationPlan: string;
  rollbackPlan: string;
};
type Actor = { id: string; role: Role };

const FINISHED: ChangeStatus[] = ["COMPLETED", "FAILED", "ROLLED_BACK"];

/** The status an action leads to from the current state, or null if the action isn't possible. */
export function nextChangeStatus(c: Pick<ChangeLike, "status" | "type" | "approverId">, action: ChangeAction): ChangeStatus | null {
  switch (action) {
    case "submit":
      return c.status === "DRAFT" && c.type !== "STANDARD" ? "SUBMITTED" : null;
    case "approve":
      if (c.status === "SUBMITTED") return "APPROVED";
      // Emergency changes can be approved after the fact; the status stays where it is
      if (c.type === "EMERGENCY" && !c.approverId && (c.status === "IN_PROGRESS" || FINISHED.includes(c.status))) return c.status;
      return null;
    case "reject":
      return c.status === "SUBMITTED" ? "REJECTED" : null;
    case "start":
      if (c.status === "APPROVED") return "IN_PROGRESS";
      if (c.status === "DRAFT" && c.type === "STANDARD") return "IN_PROGRESS"; // pre-approved
      if (c.status === "SUBMITTED" && c.type === "EMERGENCY") return "IN_PROGRESS";
      return null;
    case "complete":
      return c.status === "IN_PROGRESS" ? "COMPLETED" : null;
    case "fail":
      return c.status === "IN_PROGRESS" ? "FAILED" : null;
    case "rollback":
      return c.status === "IN_PROGRESS" ? "ROLLED_BACK" : null;
    case "cancel":
      return ["DRAFT", "SUBMITTED", "APPROVED"].includes(c.status) ? "CANCELLED" : null;
    case "reopen":
      return c.status === "REJECTED" ? "DRAFT" : null;
  }
}

/** Why this person may not approve or reject (segregation of duties), or null if they may. */
export function decisionBlocker(c: Pick<ChangeLike, "requesterId" | "risk">, actor: Actor): string | null {
  if (c.requesterId && c.requesterId === actor.id) return "You can't approve or reject a change you requested.";
  if (c.risk === "HIGH" && actor.role !== "ADMIN") return "High-risk changes need an administrator's approval.";
  return null;
}

/** Fields a change needs before it can be submitted or started. */
export function missingForSubmit(c: ChangeLike): string[] {
  const missing: string[] = [];
  if (!c.plannedStart || !c.plannedEnd) missing.push("planned window");
  if (!c.implementationPlan.trim()) missing.push("implementation plan");
  if (c.type !== "STANDARD" && !c.rollbackPlan.trim()) missing.push("rollback plan");
  return missing;
}

/**
 * Changes can be edited before approval. Editing a submitted change returns it to Draft, so an
 * approver never signs off on a plan that changed after review. Rejected changes are reopened first.
 */
export const changeEditable = (s: ChangeStatus) => s === "DRAFT" || s === "SUBMITTED";

/** Do two windows overlap? Used to warn about clashing changes. */
export const windowsOverlap = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

// ───────────────────────────── Incidents ─────────────────────────────

const ORDER: IncidentStatus[] = ["OPEN", "INVESTIGATING", "MITIGATED", "RESOLVED", "CLOSED"];

type IncidentLike = {
  status: IncidentStatus;
  severity: IncidentSeverity;
  mitigatedAt: Date | null;
  resolvedAt: Date | null;
  rootCause: string | null;
  resolution: string | null;
};

/**
 * Validates a status change and returns the timestamps to set. Incidents may move forward any
 * number of steps; a resolved or closed incident can be reopened to Investigating.
 */
export function incidentStatusChange(i: IncidentLike, to: IncidentStatus, now = new Date()): { error: string } | { set: Partial<Record<"mitigatedAt" | "resolvedAt" | "closedAt", Date | null>> } {
  if (to === i.status) return { error: `Already ${to.toLowerCase()}.` };
  const from = ORDER.indexOf(i.status);
  const target = ORDER.indexOf(to);
  if (target < from) {
    if (to === "INVESTIGATING" && (i.status === "RESOLVED" || i.status === "CLOSED")) return { set: { resolvedAt: null, closedAt: null } };
    return { error: "An incident can only be reopened to Investigating." };
  }
  if (target >= ORDER.indexOf("RESOLVED") && !i.resolution?.trim()) return { error: "Record how it was resolved before marking it resolved." };
  if (to === "CLOSED" && (i.severity === "P1" || i.severity === "P2") && !i.rootCause?.trim()) return { error: "P1 and P2 incidents need a root cause before they can be closed." };
  const set: Partial<Record<"mitigatedAt" | "resolvedAt" | "closedAt", Date | null>> = {};
  if (target >= ORDER.indexOf("MITIGATED") && !i.mitigatedAt) set.mitigatedAt = now;
  if (target >= ORDER.indexOf("RESOLVED") && !i.resolvedAt) set.resolvedAt = now;
  if (to === "CLOSED") set.closedAt = now;
  return { set };
}

export const incidentOpen = (s: IncidentStatus) => s !== "RESOLVED" && s !== "CLOSED";

/** "2h 15m" style duration between two moments. */
export function duration(from: Date, to: Date | null | undefined): string | null {
  if (!to) return null;
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d && `${d}d`, h && `${h}h`, (m || (!d && !h)) && `${m}m`].filter(Boolean).join(" ");
}

export const changeNo = (n: number) => `CHG-${String(n).padStart(5, "0")}`;
export const incidentNo = (n: number) => `INC-${String(n).padStart(5, "0")}`;

/** Parses "CHG-123" / "INC-00042" / "chg123" for search and lookups. */
export function parseRecordNo(s: string): { kind: "change" | "incident"; number: number } | null {
  const m = /^\s*(chg|inc)-?0*(\d{1,9})\s*$/i.exec(s);
  return m ? { kind: m[1].toLowerCase() === "chg" ? "change" : "incident", number: Number(m[2]) } : null;
}
