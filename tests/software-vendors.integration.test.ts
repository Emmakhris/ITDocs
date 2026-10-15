import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import {
  addContractFile,
  contractsForAsset,
  coverAsset,
  deleteVendor,
  getContract,
  listContracts,
  readContractFile,
  renewals,
  saveContact,
  saveContract,
  saveVendor,
} from "@/server/modules/vendors";
import { assignSeat, getLicense, getSoftware, overAllocated, revealLicenseKey, saveLicense, saveSoftware, seatsFor, unassignSeat } from "@/server/modules/software";
import { createCredential, saveFolder } from "@/server/modules/vault";
import { globalSearch } from "@/server/modules/search";
import { AppError, FieldError, ForbiddenError } from "@/server/lib/errors";
import { ZodError } from "zod";

const run = Date.now().toString(36);
const DAY = 86_400_000;
const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `s-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};
const fieldErr = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(FieldError);
  return (e as FieldError).fieldErrors;
};

let admin: Ctx, tech: Ctx, viewer: Ctx, auditor: Ctx;
let vendorId: string, assetA: string, assetB: string, person1: string, person2: string;

beforeAll(async () => {
  [admin, tech, viewer, auditor] = await Promise.all([mkUser("ADMIN", "admin"), mkUser("TECHNICIAN", "tech"), mkUser("READONLY", "viewer"), mkUser("AUDITOR", "auditor")]);
  vendorId = (await saveVendor(tech, null, { name: `Acme Medical ${run}`, supportPhone: "+1 555 0100", supportUrl: "https://support.acme.example" })).id;
  const type = await db.assetType.upsert({ where: { name: "Licensing test type" }, create: { name: "Licensing test type" }, update: {} });
  assetA = (await db.asset.create({ data: { tag: `SW-A-${run}`, name: "PC A", typeId: type.id } })).id;
  assetB = (await db.asset.create({ data: { tag: `SW-B-${run}`, name: "PC B", typeId: type.id, status: "RETIRED" } })).id;
  person1 = (await db.person.create({ data: { name: `Pat One ${run}` } })).id;
  person2 = (await db.person.create({ data: { name: `Sam Two ${run}`, active: false } })).id;
});

describe("vendors and contracts", () => {
  it("validates vendor fields and keeps names unique", async () => {
    expect((await fieldErr(saveVendor(tech, null, { name: `Acme Medical ${run}` }))).name).toMatch(/already exists/);
    await expect(saveVendor(tech, null, { name: `Bad ${run}`, website: "javascript:alert(1)" })).rejects.toBeInstanceOf(ZodError);
    await saveContact(tech, vendorId, null, { name: "Jo Support", role: "Account manager", email: "jo@acme.example" });
    expect(await db.auditLog.count({ where: { entityType: "Vendor", entityId: vendorId } })).toBe(2);
  });

  it("tracks notice deadlines and shows them in renewals", async () => {
    const now = Date.now();
    const c = await saveContract(tech, null, {
      vendorId,
      title: `PACS support ${run}`,
      type: "SUPPORT",
      endDate: new Date(now + 120 * DAY).toISOString(),
      noticeDays: 90,
      autoRenew: "on",
      annualCost: "48000",
    });
    const full = await getContract(viewer, c.id);
    expect(full.state).toBe("notice-soon");
    expect(full.annualCost).toBe("48000");
    const r = (await renewals(viewer, 60)).find((x) => x.id === c.id);
    expect(r?.what).toMatch(/Notice deadline/);
    expect(r?.daysLeft).toBe(30);
    expect((await listContracts(viewer, { state: "soon" })).some((x) => x.id === c.id)).toBe(true);

    await expect(saveContract(tech, null, { vendorId, title: "x", startDate: "2026-05-01", endDate: "2026-01-01" })).rejects.toBeInstanceOf(ZodError);
  });

  it("covers assets and stores contract documents", async () => {
    const c = await saveContract(tech, null, { vendorId, title: `Warranty ${run}`, type: "WARRANTY" });
    await coverAsset(tech, c.id, assetA);
    expect((await contractsForAsset(viewer, assetA)).map((x) => x.id)).toContain(c.id);
    const att = await addContractFile(tech, c.id, new File(["signed"], "contract.pdf", { type: "application/pdf" }));
    expect(att.storageKey).toMatch(/^contracts\//);
    expect((await readContractFile(viewer, att.id)).data.toString()).toBe("signed");
    expect((await getContract(viewer, c.id)).assets.map((a) => a.id)).toEqual([assetA]);
  });

  it("links a support-portal login only for people who can open it", async () => {
    const folder = await saveFolder(admin, null, { name: `Vendor logins ${run}`, restricted: "on" });
    const cred = await createCredential(admin, { folderId: folder.id, title: `Acme portal ${run}`, password: "pw" });
    expect((await fieldErr(saveContract(tech, null, { vendorId, title: "x", credentialId: cred.id }))).credentialId).toBeTruthy();
    const c = await saveContract(admin, null, { vendorId, title: `Portal ${run}`, credentialId: cred.id });
    expect((await getContract(admin, c.id)).credential?.title).toBe(`Acme portal ${run}`);
    expect((await getContract(viewer, c.id)).credential).toBeNull();
    await saveContract(tech, c.id, { vendorId, title: `Portal ${run}`, notes: "edited" });
    expect((await db.contract.findUnique({ where: { id: c.id } }))?.credentialId).toBe(cred.id);
  });

  it("refuses to delete a vendor that still has contracts", async () => {
    await expect(deleteVendor(tech, vendorId)).rejects.toBeInstanceOf(AppError);
  });
});

describe("software and licences", () => {
  let softwareId: string;
  beforeAll(async () => {
    softwareId = (await saveSoftware(tech, null, { name: `Office ${run}`, vendorId, category: "Productivity" })).id;
  });

  it("encrypts licence keys, audits reveals and never logs the key", async () => {
    const l = await saveLicense(tech, null, { softwareId, name: "Volume licence", seatBasis: "DEVICE", seats: "2", licenseKey: "ABCDE-12345-FGHIJ" });
    const row = await db.license.findUniqueOrThrow({ where: { id: l.id } });
    expect(row.keyEnc).not.toContain("ABCDE");
    expect(await revealLicenseKey(tech, l.id)).toBe("ABCDE-12345-FGHIJ");
    await expect(revealLicenseKey(viewer, l.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { entityId: l.id, action: "view_sensitive" } })).toBe(1);
    const logs = JSON.stringify(await db.auditLog.findMany({ where: { entityId: l.id } }), (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(logs).not.toContain("ABCDE");
    expect(logs).not.toContain(row.keyEnc!);

    // Blank key on edit keeps it; clearKey removes it
    await saveLicense(tech, l.id, { softwareId, name: "Volume licence", seatBasis: "DEVICE", seats: "2" });
    expect(await revealLicenseKey(tech, l.id)).toBe("ABCDE-12345-FGHIJ");
    await saveLicense(tech, l.id, { softwareId, name: "Volume licence", seatBasis: "DEVICE", seats: "2", clearKey: "on" });
    await expect(revealLicenseKey(tech, l.id)).rejects.toThrow(/No key/);
  });

  it("enforces seat basis, flags over-allocation and stale seats", async () => {
    const l = await saveLicense(tech, null, { softwareId, name: "Per-device", seatBasis: "DEVICE", seats: "1" });
    expect((await fieldErr(assignSeat(tech, l.id, { personId: person1 }))).personId).toMatch(/per device/);
    expect((await assignSeat(tech, l.id, { assetId: assetA })).over).toBe(0);
    expect((await fieldErr(assignSeat(tech, l.id, { assetId: assetA }))).assetId).toMatch(/already has a seat/);
    const second = await assignSeat(tech, l.id, { assetId: assetB });
    expect(second.over).toBe(1);

    const full = await getLicense(viewer, l.id);
    expect(full.usage).toEqual({ used: 2, seats: 1, free: 0, over: 1 });
    expect(full.stale).toBe(1); // assetB is retired
    expect((await overAllocated(viewer)).some((x) => x.id === l.id)).toBe(true);
    expect((await getSoftware(viewer, softwareId)).summary.over).toBeGreaterThanOrEqual(1);
    expect((await seatsFor(viewer, { assetId: assetA })).map((s) => s.license.id)).toContain(l.id);

    await unassignSeat(tech, second.assignment.id);
    expect((await getLicense(viewer, l.id)).usage.over).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: l.id, action: { in: ["assign", "unassign"] } } })).toBe(3);
  });

  it("supports per-user and site licences", async () => {
    const user = await saveLicense(tech, null, { softwareId, name: "Per-user", seatBasis: "USER", seats: "5" });
    await assignSeat(tech, user.id, { personId: person1 });
    await assignSeat(tech, user.id, { personId: person2 });
    expect((await getLicense(viewer, user.id)).stale).toBe(1); // person2 has left
    const site = await saveLicense(tech, null, { softwareId, name: "Site", seatBasis: "SITE" });
    expect(site.seats).toBeNull();
    expect((await getLicense(viewer, site.id)).usage.seats).toBeNull();
    await expect(saveLicense(tech, null, { softwareId, name: "No seats", seatBasis: "USER" })).rejects.toBeInstanceOf(ZodError);
  });

  it("blocks writes for read-only roles and finds licences in search", async () => {
    await expect(saveSoftware(viewer, null, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveLicense(auditor, null, { softwareId, name: "x", seatBasis: "SITE" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveVendor(auditor, null, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveContract(viewer, null, { vendorId, title: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { actorId: { in: [viewer.user.id, auditor.user.id] } } })).toBe(0);
    const hits = await globalSearch(viewer, `Office ${run}`);
    expect(hits.some((h) => h.kind === "Software")).toBe(true);
    expect((await globalSearch(viewer, `Acme Medical ${run}`)).some((h) => h.kind === "Vendor")).toBe(true);
  });

  it("includes expiring licences in renewals", async () => {
    const l = await saveLicense(tech, null, { softwareId, name: "Expiring", seatBasis: "SITE", expiresAt: new Date(Date.now() + 20 * DAY).toISOString() });
    const r = (await renewals(viewer)).find((x) => x.id === l.id);
    expect(r?.kind).toBe("license");
    expect(r?.state).toBe("expiring");
  });
});
