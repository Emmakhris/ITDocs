import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { createChange, getChange, linkAffected, recordsForAsset, transitionChange, updateChange } from "@/server/modules/changes";
import { addIncidentUpdate, createIncident, getIncident, setIncidentStatus, updateIncident } from "@/server/modules/incidents";
import { addJournalEntry, deleteJournalEntry, listJournal, updateJournalEntry } from "@/server/modules/journal";
import { globalSearch } from "@/server/modules/search";
import { changeNo, incidentNo } from "@/server/lib/workflow";
import { AppError, FieldError, ForbiddenError } from "@/server/lib/errors";

const run = Date.now().toString(36);
const H = 3600e3;
const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `c-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};
const planned = (startH: number, endH: number) => ({
  plannedStart: new Date(Date.now() + startH * H).toISOString(),
  plannedEnd: new Date(Date.now() + endH * H).toISOString(),
  implementationPlan: "1. Do the thing",
  rollbackPlan: "Undo the thing",
});

let admin: Ctx, tech: Ctx, tech2: Ctx, viewer: Ctx, assetId: string;
beforeAll(async () => {
  [admin, tech, tech2, viewer] = await Promise.all([mkUser("ADMIN", "admin"), mkUser("TECHNICIAN", "tech"), mkUser("TECHNICIAN", "tech2"), mkUser("READONLY", "viewer")]);
  const type = await db.assetType.upsert({ where: { name: "Change test type" }, create: { name: "Change test type" }, update: {} });
  assetId = (await db.asset.create({ data: { tag: `CH-${run}`, name: "Core switch", typeId: type.id } })).id;
});

describe("change workflow", () => {
  it("requires a plan, separates requester and approver, and audits every step", async () => {
    const c = await createChange(tech, { title: `Firmware upgrade ${run}`, risk: "MEDIUM" });
    expect(changeNo(c.number)).toMatch(/^CHG-\d{5}$/);
    await expect(transitionChange(tech, c.id, "submit")).rejects.toThrow(/planned window, implementation plan, rollback plan/);
    await updateChange(tech, c.id, { title: c.title, risk: "MEDIUM", ...planned(48, 50) });
    await transitionChange(tech, c.id, "submit");

    await expect(transitionChange(tech, c.id, "approve")).rejects.toThrow(/you requested/);
    await expect(transitionChange(tech2, c.id, "start")).rejects.toBeInstanceOf(AppError); // not approved
    await transitionChange(tech2, c.id, "approve", "Looks good");
    await transitionChange(tech, c.id, "start");
    await expect(transitionChange(tech, c.id, "rollback")).rejects.toBeInstanceOf(FieldError); // needs a reason
    const done = await transitionChange(tech, c.id, "complete", "All switches on 17.9");
    expect(done.status).toBe("COMPLETED");
    expect(done.approverName).toBe(tech2.user.displayName);
    expect(done.actualStart && done.actualEnd).toBeTruthy();
    const steps = (await db.auditLog.findMany({ where: { entityType: "ChangeRequest", entityId: c.id }, orderBy: { at: "asc" } })).map((a) => a.action);
    expect(steps).toEqual(["create", "update", "change_submit", "change_approve", "change_start", "change_complete"]);
  });

  it("needs an admin to approve high-risk changes, and sends edited submissions back to draft", async () => {
    const c = await createChange(tech, { title: `Core router swap ${run}`, risk: "HIGH", ...planned(72, 76) });
    await transitionChange(tech, c.id, "submit");
    await expect(transitionChange(tech2, c.id, "approve")).rejects.toThrow(/administrator/);
    const edited = await updateChange(tech, c.id, { title: `Core router swap ${run}`, risk: "HIGH", ...planned(96, 100) });
    expect(edited.status).toBe("DRAFT");
    await transitionChange(tech, c.id, "submit");
    await transitionChange(admin, c.id, "reject", "Clashes with the EHR upgrade");
    await expect(updateChange(tech, c.id, { title: "x" })).rejects.toThrow(/Reopen it first/);
    expect((await transitionChange(tech, c.id, "reopen")).status).toBe("DRAFT");
  });

  it("lets standard changes start straight away and emergencies be approved afterwards", async () => {
    const std = await createChange(tech, { title: `Patch Tuesday ${run}`, type: "STANDARD", risk: "LOW", ...planned(1, 2), rollbackPlan: "" });
    expect((await transitionChange(tech, std.id, "start")).status).toBe("IN_PROGRESS");

    const em = await createChange(tech, { title: `Emergency fix ${run}`, type: "EMERGENCY", ...planned(0.1, 1) });
    await transitionChange(tech, em.id, "submit");
    await transitionChange(tech, em.id, "start");
    await transitionChange(tech, em.id, "complete", "Fixed");
    const approved = await transitionChange(admin, em.id, "approve", "Retrospective CAB approval");
    expect([approved.status, approved.approverName]).toEqual(["COMPLETED", admin.user.displayName]);
    expect((await db.auditLog.findFirst({ where: { entityId: em.id, action: "change_approve" } }))?.summary).toMatch(/retrospectively/);
  });

  it("warns about clashing windows on the same asset", async () => {
    const a = await createChange(tech, { title: `Clash A ${run}`, ...planned(200, 204) });
    const b = await createChange(tech2, { title: `Clash B ${run}`, ...planned(203, 205) });
    await linkAffected(tech, "Change", a.id, assetId);
    await linkAffected(tech, "Change", b.id, assetId);
    await transitionChange(tech, a.id, "submit");
    await transitionChange(tech2, b.id, "submit");
    const full = await getChange(viewer, a.id);
    // Earlier test runs leave other changes in similar windows; only this run's B shares the asset
    expect(full.clashes.find((c) => c.id === b.id)?.sharesAssets).toBe(true);
    expect(full.clashes.filter((c) => c.sharesAssets).map((c) => c.id)).toEqual([b.id]);
    expect((await recordsForAsset(viewer, assetId)).changes.map((c) => c.id)).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it("blocks read-only users", async () => {
    await expect(createChange(viewer, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createIncident(viewer, { title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addJournalEntry(viewer, { text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { actorId: viewer.user.id } })).toBe(0);
  });
});

describe("incidents", () => {
  it("keeps an append-only timeline and enforces resolution and root cause", async () => {
    const chg = await createChange(tech, { title: `Cause ${run}`, type: "STANDARD", ...planned(1, 2) });
    const i = await createIncident(tech, { title: `EHR slow ${run}`, severity: "P2", causedByChangeId: chg.id });
    expect(incidentNo(i.number)).toMatch(/^INC-\d{5}$/);
    await addIncidentUpdate(tech, i.id, "Vendor engaged");
    await setIncidentStatus(tech, i.id, "MITIGATED", "Failed over to node B");
    await expect(setIncidentStatus(tech, i.id, "RESOLVED")).rejects.toThrow(/how it was resolved/);
    await updateIncident(tech, i.id, { title: i.title, severity: "P1", ownerId: tech2.user.id, resolution: "Patched DB driver", causedByChangeId: chg.id });
    await setIncidentStatus(tech, i.id, "RESOLVED");
    await expect(setIncidentStatus(tech, i.id, "CLOSED")).rejects.toThrow(/root cause/);
    await updateIncident(tech, i.id, { title: i.title, severity: "P1", ownerId: tech2.user.id, resolution: "Patched DB driver", rootCause: "Driver bug after upgrade", causedByChangeId: chg.id });
    const closed = await setIncidentStatus(tech, i.id, "CLOSED");
    expect(closed.mitigatedAt && closed.resolvedAt && closed.closedAt).toBeTruthy();

    const full = await getIncident(viewer, i.id);
    expect(full.updates.map((u) => u.kind)).toEqual(["status", "note", "status", "severity", "owner", "status", "status"]);
    expect(full.causedByChange?.id).toBe(chg.id);
    await expect(db.incidentUpdate.updateMany({ where: { incidentId: i.id }, data: { text: "rewritten" } })).rejects.toThrow();

    const reopened = await setIncidentStatus(tech, i.id, "INVESTIGATING", "Recurred");
    expect([reopened.resolvedAt, reopened.closedAt]).toEqual([null, null]);
    expect((await globalSearch(viewer, incidentNo(i.number))).some((h) => h.id === i.id)).toBe(true);
  });
});

describe("journal", () => {
  it("lists a day's entries and lets only the author edit within 24 hours", async () => {
    const e = await addJournalEntry(tech, { text: `Called out for UPS alarm ${run}`, tags: "#ups, On Call", onCall: "on" });
    expect(e.tags).toEqual(["ups", "on-call"]);
    const today = await listJournal(viewer, {});
    expect(today.find((x) => x.id === e.id)?.editable).toBe(false);
    expect((await listJournal(tech, {})).find((x) => x.id === e.id)?.editable).toBe(true);

    await expect(updateJournalEntry(tech2, e.id, { text: "not mine" })).rejects.toBeInstanceOf(ForbiddenError);
    await updateJournalEntry(tech, e.id, { text: `Called out for UPS alarm ${run} — battery swapped`, onCall: "on" });
    await db.journalEntry.update({ where: { id: e.id }, data: { createdAt: new Date(Date.now() - 25 * H) } });
    await expect(updateJournalEntry(tech, e.id, { text: "late edit" })).rejects.toThrow(/24 hours/);
    await deleteJournalEntry(admin, e.id); // admins can remove any entry
    expect((await listJournal(tech, { q: run })).map((x) => x.id)).not.toContain(e.id);
    await expect(addJournalEntry(tech, { text: "future", at: new Date(Date.now() + 2 * H).toISOString() })).rejects.toThrow(/last 7 days/);
  });
});
