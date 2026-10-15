import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { cleanParams, getReportDef, reportsFor, runReport } from "@/server/modules/reports";
import { createSubscription, notifyIncident, parseRecipients, runScheduled, saveAlertSettings, sendDigest } from "@/server/modules/alerts";
import { createDiagram, diagramsFor, getDiagram, linkDiagramAsset, readDiagramFile } from "@/server/modules/diagrams";
import { relationsFor } from "@/server/modules/relations";
import { createIncident, updateIncident } from "@/server/modules/incidents";
import { createArticle, linkArticle } from "@/server/modules/kb";
import { createCredential, linkAsset, saveFolder } from "@/server/modules/vault";
import { getSettings, updateSettings, type AppSettings } from "@/server/modules/settings";
import { buildXlsx } from "@/server/lib/xlsx";
import { FieldError, ForbiddenError } from "@/server/lib/errors";

const run = Date.now().toString(36);
const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `p8-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let admin: Ctx, tech: Ctx, viewer: Ctx, auditor: Ctx, assetId: string, locationId: string;
let saved: AppSettings;

beforeAll(async () => {
  [admin, tech, viewer, auditor] = await Promise.all([mkUser("ADMIN", "admin"), mkUser("TECHNICIAN", "tech"), mkUser("READONLY", "viewer"), mkUser("AUDITOR", "auditor")]);
  saved = await getSettings();
  const type = await db.assetType.upsert({ where: { name: "Phase 8 test type" }, create: { name: "Phase 8 test type" }, update: {} });
  const person = await db.person.create({ data: { name: `Map Person ${run}` } });
  locationId = (await db.location.create({ data: { name: `Comms room ${run}`, type: "ROOM" } })).id;
  assetId = (await db.asset.create({ data: { tag: `P8-${run}`, name: "Core switch", typeId: type.id, locationId, assigneeId: person.id, warrantyEnd: new Date(Date.now() + 10 * 86_400_000) } })).id;
});

afterAll(async () => {
  await updateSettings(admin, { alertRecipients: saved.alertRecipients, digestEnabled: saved.digestEnabled, digestHour: saved.digestHour, incidentAlerts: saved.incidentAlerts });
  vi.unstubAllGlobals();
  delete process.env.TEAMS_WEBHOOK_URL;
});

describe("reports", () => {
  it("lists only reports the role may see", async () => {
    const keys = (c: Ctx) => reportsFor(c).map((r) => r.key);
    expect(keys(viewer)).toContain("inventory");
    expect(keys(viewer)).not.toContain("vault-rotation"); // no vault access
    expect(keys(tech)).not.toContain("user-access"); // admins and auditors only
    expect(keys(auditor)).toContain("user-access");
    expect(() => getReportDef(viewer, "vault-rotation")).toThrow(ForbiddenError);
  });

  it("runs with validated parameters and exports to Excel", async () => {
    const def = getReportDef(viewer, "warranty");
    expect(cleanParams(def, { days: "9999" })).toEqual({ days: 90 }); // not an offered value → default
    const r = await runReport(viewer, "warranty", { days: "30" });
    expect(r.params).toEqual({ days: 30 });
    expect(r.rows.some((row) => row[0] === `P8-${run}`)).toBe(true);
    const inv = await runReport(viewer, "inventory", { status: "IN_STOCK" });
    expect(inv.columns[0]).toBe("Tag");
    expect(buildXlsx(inv.def.title, inv.columns, inv.rows).length).toBeGreaterThan(500);
  });
});

describe("alerts", () => {
  it("validates recipients", () => {
    expect(parseRecipients("a@x.org; B@x.org, a@x.org")).toEqual(["a@x.org", "b@x.org"]);
    expect(() => parseRecipients("not-an-email")).toThrow(FieldError);
  });

  it("sends the digest once per day per channel, including Teams", async () => {
    const posts: unknown[] = [];
    process.env.TEAMS_WEBHOOK_URL = "https://example.webhook.office.com/hook";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => (posts.push(JSON.parse(String(init.body))), new Response("1", { status: 200 }))));
    await saveAlertSettings(admin, { alertRecipients: "it-team@example.org", digestEnabled: "on", digestHour: "0", incidentAlerts: "on" });
    await db.alertDelivery.deleteMany({ where: { dedupeKey: { startsWith: "digest:" } } });

    const first = await sendDigest(new Date());
    expect(first.status).toBe("done");
    if (first.status === "done") expect([first.email, first.teams]).toEqual(["sent", "sent"]);
    const second = await sendDigest(new Date());
    if (second.status === "done") expect([second.email, second.teams]).toEqual(["duplicate", "duplicate"]);
    expect(posts).toHaveLength(1);
    const card = (posts[0] as { attachments: { content: { body: { text?: string }[] } }[] }).attachments[0].content;
    expect(card.body[0].text).toMatch(/daily digest/);
    const email = await db.alertDelivery.findFirst({ where: { channel: "EMAIL", kind: "digest" }, orderBy: { at: "desc" } });
    expect([email?.status, email?.recipients]).toEqual(["SENT", "it-team@example.org"]);
  });

  it("alerts on P1/P2 incidents when opened or escalated, never twice, and not for P3/P4", async () => {
    const before = await db.alertDelivery.count({ where: { kind: "incident" } });
    const p1 = await createIncident(tech, { title: `Site down ${run}`, severity: "P1" });
    await notifyIncident(p1.id, "opened"); // a repeat is deduplicated
    expect(await db.alertDelivery.count({ where: { kind: "incident" } })).toBe(before + 2); // email + Teams
    const p4 = await createIncident(tech, { title: `Mouse broken ${run}`, severity: "P4" });
    expect(await db.alertDelivery.count({ where: { kind: "incident" } })).toBe(before + 2);
    await updateIncident(tech, p4.id, { title: p4.title, severity: "P2", ownerId: tech.user.id });
    expect(await db.alertDelivery.count({ where: { kind: "incident", dedupeKey: `incident:${p4.id}:P2` } })).toBe(2);
  });

  it("emails scheduled reports when due, exactly once even with two schedulers", async () => {
    await expect(createSubscription(tech, { reportKey: "inventory", recipients: "nope" })).rejects.toBeInstanceOf(FieldError);
    await expect(createSubscription(viewer, { reportKey: "inventory", recipients: "a@x.org" })).rejects.toBeInstanceOf(ForbiddenError);
    const sub = await createSubscription(tech, { reportKey: "warranty", frequency: "WEEKLY", format: "XLSX", recipients: "boss@example.org", params: { days: "30", junk: "x" } });
    expect(sub.params).toEqual({ days: "30" });
    await db.reportSubscription.update({ where: { id: sub.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
    await Promise.all([runScheduled(), runScheduled()]);
    const sent = await db.alertDelivery.findMany({ where: { kind: "report", dedupeKey: { startsWith: `report:${sub.id}:` } } });
    expect(sent.map((s) => s.status)).toEqual(["SENT"]);
    const after = await db.reportSubscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
  });
});

describe("diagrams", () => {
  it("accepts real images only, detects the type from content, and links assets", async () => {
    await expect(createDiagram(tech, { title: "x" }, new File(["<html><script>alert(1)</script>"], "plan.png", { type: "image/png" }))).rejects.toBeInstanceOf(FieldError);
    await expect(createDiagram(viewer, { title: "x" }, new File([PNG], "a.png"))).rejects.toBeInstanceOf(ForbiddenError);
    const d = await createDiagram(tech, { title: `Comms room ${run}`, kind: "FLOOR_PLAN", locationId }, new File([PNG], "room.bin", { type: "text/html" }));
    const full = await getDiagram(viewer, d.id);
    expect(full.files[0].mimeType).toBe("image/png");
    expect((await readDiagramFile(viewer, full.files[0].id)).data.length).toBe(PNG.length);
    await linkDiagramAsset(tech, d.id, assetId);
    expect((await diagramsFor(viewer, { assetId })).map((x) => x.id)).toEqual([d.id]);
    expect((await diagramsFor(viewer, { locationId })).map((x) => x.id)).toEqual([d.id]);
  });
});

describe("relationship map", () => {
  it("shows connected records, filtered by what the viewer may see", async () => {
    const art = await createArticle(tech, { title: `Switch runbook ${run}`, body: "x", status: "PUBLISHED" });
    await linkArticle(tech, art.id, "Asset", assetId);
    const folder = await saveFolder(admin, null, { name: `Switch logins ${run}`, restricted: "on" });
    const cred = await createCredential(admin, { folderId: folder.id, title: `Switch admin ${run}`, password: "x" });
    await linkAsset(admin, cred.id, assetId);

    const types = async (c: Ctx) => (await relationsFor(c, "Asset", assetId)).neighbours.map((n) => n.node.type).sort();
    const forAdmin = await types(admin);
    expect(forAdmin).toEqual(expect.arrayContaining(["Article", "Credential", "Diagram", "Location", "Person"]));
    expect(await types(tech)).not.toContain("Credential"); // restricted folder
    expect(await types(viewer)).not.toContain("Credential"); // no vault access at all

    const fromArticle = await relationsFor(viewer, "Article", art.id);
    expect(fromArticle.neighbours.map((n) => n.node.id)).toContain(assetId);
    const loc = await relationsFor(viewer, "Location", locationId);
    expect(loc.neighbours.find((n) => n.node.id === assetId)?.label).toBe("holds");
  });
});
