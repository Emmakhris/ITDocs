import { describe, expect, it } from "vitest";
import { changeNo, decisionBlocker, duration, incidentStatusChange, missingForSubmit, nextChangeStatus, parseRecordNo, windowsOverlap } from "@/server/lib/workflow";

const base = { status: "DRAFT" as const, type: "NORMAL" as const, risk: "MEDIUM" as const, requesterId: "u1", approverId: null, plannedStart: null, plannedEnd: null, implementationPlan: "", rollbackPlan: "" };

describe("change workflow", () => {
  it("follows the normal path", () => {
    expect(nextChangeStatus(base, "submit")).toBe("SUBMITTED");
    expect(nextChangeStatus({ ...base, status: "SUBMITTED" }, "approve")).toBe("APPROVED");
    expect(nextChangeStatus({ ...base, status: "SUBMITTED" }, "start")).toBeNull(); // not approved yet
    expect(nextChangeStatus({ ...base, status: "APPROVED" }, "start")).toBe("IN_PROGRESS");
    expect(nextChangeStatus({ ...base, status: "IN_PROGRESS" }, "rollback")).toBe("ROLLED_BACK");
    expect(nextChangeStatus({ ...base, status: "COMPLETED" }, "cancel")).toBeNull();
    expect(nextChangeStatus({ ...base, status: "REJECTED" }, "reopen")).toBe("DRAFT");
  });

  it("lets standard changes start without approval and emergencies start before it", () => {
    expect(nextChangeStatus({ ...base, type: "STANDARD" }, "start")).toBe("IN_PROGRESS");
    expect(nextChangeStatus({ ...base, type: "STANDARD" }, "submit")).toBeNull();
    expect(nextChangeStatus({ ...base, type: "EMERGENCY", status: "SUBMITTED" }, "start")).toBe("IN_PROGRESS");
    // retrospective approval keeps the status
    expect(nextChangeStatus({ ...base, type: "EMERGENCY", status: "COMPLETED" }, "approve")).toBe("COMPLETED");
    expect(nextChangeStatus({ ...base, type: "EMERGENCY", status: "COMPLETED", approverId: "u2" }, "approve")).toBeNull();
  });

  it("enforces segregation of duties and admin approval for high risk", () => {
    expect(decisionBlocker(base, { id: "u1", role: "ADMIN" })).toMatch(/you requested/);
    expect(decisionBlocker(base, { id: "u2", role: "TECHNICIAN" })).toBeNull();
    expect(decisionBlocker({ ...base, risk: "HIGH" }, { id: "u2", role: "TECHNICIAN" })).toMatch(/administrator/);
    expect(decisionBlocker({ ...base, risk: "HIGH" }, { id: "u2", role: "ADMIN" })).toBeNull();
  });

  it("lists what's missing before submit", () => {
    expect(missingForSubmit(base)).toEqual(["planned window", "implementation plan", "rollback plan"]);
    expect(missingForSubmit({ ...base, type: "STANDARD", plannedStart: new Date(), plannedEnd: new Date(), implementationPlan: "x" })).toEqual([]);
  });

  it("detects overlapping windows", () => {
    const w = (a: number, b: number) => ({ start: new Date(a * 3600e3), end: new Date(b * 3600e3) });
    expect(windowsOverlap(w(1, 3), w(2, 4))).toBe(true);
    expect(windowsOverlap(w(1, 2), w(2, 3))).toBe(false); // back to back
  });
});

describe("incident workflow", () => {
  const inc = { status: "OPEN" as const, severity: "P2" as const, mitigatedAt: null, resolvedAt: null, rootCause: null, resolution: null };
  const now = new Date("2026-10-15T10:00:00Z");

  it("sets timestamps as it moves forward", () => {
    expect(incidentStatusChange(inc, "MITIGATED", now)).toEqual({ set: { mitigatedAt: now } });
    expect(incidentStatusChange({ ...inc, resolution: "Restarted service" }, "RESOLVED", now)).toEqual({ set: { mitigatedAt: now, resolvedAt: now } });
  });

  it("requires a resolution, and a root cause to close P1/P2", () => {
    expect(incidentStatusChange(inc, "RESOLVED", now)).toEqual({ error: expect.stringMatching(/how it was resolved/) });
    expect(incidentStatusChange({ ...inc, status: "RESOLVED", resolution: "x" }, "CLOSED", now)).toEqual({ error: expect.stringMatching(/root cause/) });
    expect("set" in incidentStatusChange({ ...inc, severity: "P3", status: "RESOLVED", resolution: "x" }, "CLOSED", now)).toBe(true);
  });

  it("reopens only to investigating", () => {
    expect(incidentStatusChange({ ...inc, status: "CLOSED" }, "INVESTIGATING", now)).toEqual({ set: { resolvedAt: null, closedAt: null } });
    expect(incidentStatusChange({ ...inc, status: "MITIGATED" }, "OPEN", now)).toEqual({ error: expect.any(String) });
  });
});

describe("helpers", () => {
  it("formats durations and record numbers", () => {
    const t = new Date("2026-10-15T10:00:00Z");
    expect(duration(t, new Date("2026-10-15T12:15:00Z"))).toBe("2h 15m");
    expect(duration(t, new Date("2026-10-17T10:00:00Z"))).toBe("2d");
    expect(duration(t, t)).toBe("0m");
    expect(changeNo(42)).toBe("CHG-00042");
    expect(parseRecordNo("inc-00042")).toEqual({ kind: "incident", number: 42 });
    expect(parseRecordNo("CHG7")).toEqual({ kind: "change", number: 7 });
    expect(parseRecordNo("change 7")).toBeNull();
  });
});
