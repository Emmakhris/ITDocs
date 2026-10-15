import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { createLocation } from "@/server/modules/locations";
import { createPerson } from "@/server/modules/people";
import { assetAt, checkinAsset, checkoutAsset, createAsset, disposeAsset, moveAssets, updateAsset } from "@/server/modules/assets";
import { ForbiddenError } from "@/server/lib/errors";

// Runs against the test database (see vitest.config.ts). Uses unique names per run because
// movement and audit tables are append-only and cannot be cleaned up.
const run = Date.now().toString(36);
let admin: Ctx;
let viewer: Ctx;
let typeId: string;
let medTypeId: string;
let store: string;
let ward: string;
let personId: string;

beforeAll(async () => {
  const u = await db.user.create({ data: { username: `t-admin-${run}`, displayName: "Test Admin", role: "TECHNICIAN", source: "LOCAL" } });
  const v = await db.user.create({ data: { username: `t-view-${run}`, displayName: "Test Viewer", role: "READONLY", source: "LOCAL" } });
  admin = { user: { id: u.id, username: u.username, displayName: u.displayName, role: u.role } };
  viewer = { user: { id: v.id, username: v.username, displayName: v.displayName, role: v.role } };
  typeId = (await db.assetType.create({ data: { name: `Laptop ${run}`, tagPrefix: `T${run}-`, fieldDefs: [{ key: "ram_gb", label: "RAM", kind: "number", required: false }] } })).id;
  medTypeId = (await db.assetType.create({ data: { name: `Pump ${run}`, isMedical: true, tagPrefix: `M${run}-` } })).id;
  const site = await createLocation(admin, { name: `Site ${run}`, type: "SITE" });
  store = (await createLocation(admin, { name: "Store", type: "STORAGE", parentId: site.id })).id;
  ward = (await createLocation(admin, { name: "Ward 4", type: "ROOM", parentId: site.id })).id;
  personId = (await createPerson(admin, { name: `Nurse ${run}` })).id;
});

const movements = (assetId: string) => db.assetMovement.findMany({ where: { assetId }, orderBy: { movedAt: "asc" } });

describe("asset lifecycle and movement tracking", () => {
  it("creates an asset with an auto tag, a CREATE movement and an audit row", async () => {
    const a = await createAsset(admin, { name: "Laptop A", typeId, locationId: store, customFields: { ram_gb: "16" } });
    expect(a.tag).toBe(`T${run}-000001`);
    expect(a.customFields).toEqual({ ram_gb: 16 });
    const mv = await movements(a.id);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ method: "CREATE", toLocationId: store, toLocationPath: `Site ${run} › Store`, toStatus: "IN_STOCK" });
    expect(await db.auditLog.count({ where: { entityId: a.id, action: "create" } })).toBe(1);
  });

  it("records a movement for every placement change, including edits, and none for no-op edits", async () => {
    const a = await createAsset(admin, { name: "Laptop B", typeId, locationId: store });
    await moveAssets(admin, [a.id], { toLocationId: ward, toAssigneeId: personId, toStatus: "DEPLOYED", reason: "Deploy", ticketRef: "INC1" });
    await updateAsset(admin, a.id, { name: "Laptop B renamed", typeId, locationId: ward, assigneeId: personId, status: "DEPLOYED" });
    await updateAsset(admin, a.id, { name: "Laptop B renamed", typeId, locationId: store, status: "IN_REPAIR", changeReason: "Cracked screen" });
    const mv = await movements(a.id);
    expect(mv.map((m) => m.method)).toEqual(["CREATE", "MANUAL", "MANUAL"]);
    expect(mv[1]).toMatchObject({ toAssignee: `Nurse ${run}`, toStatus: "DEPLOYED", reason: "Deploy", ticketRef: "INC1" });
    expect(mv[2]).toMatchObject({ fromAssignee: `Nurse ${run}`, toAssignee: null, toStatus: "IN_REPAIR", reason: "Cracked screen" });
  });

  it("answers where an asset was at a point in time", async () => {
    const a = await createAsset(admin, { name: "Laptop C", typeId, locationId: store });
    const before = new Date();
    await new Promise((r) => setTimeout(r, 20));
    await moveAssets(admin, [a.id], { toLocationId: ward, reason: "Moved" });
    expect((await assetAt(admin, a.id, before))?.toLocationId).toBe(store);
    expect((await assetAt(admin, a.id, new Date()))?.toLocationId).toBe(ward);
  });

  it("scan verification logs a movement even when nothing changed", async () => {
    const a = await createAsset(admin, { name: "Laptop D", typeId, locationId: ward });
    const r = await moveAssets(admin, [a.id], { toLocationId: ward, reason: "Inventory audit" }, "SCAN");
    expect(r.moved).toBe(1);
    expect((await movements(a.id)).at(-1)?.method).toBe("SCAN");
    // Manual move to the same place is a no-op
    expect((await moveAssets(admin, [a.id], { toLocationId: ward, reason: "again" })).moved).toBe(0);
  });

  it("check-out / check-in updates status and assignee and prevents double loans", async () => {
    const a = await createAsset(admin, { name: "Loaner", typeId, locationId: store });
    await checkoutAsset(admin, a.id, { personId, dueAt: "2030-01-01" });
    await expect(checkoutAsset(admin, a.id, { personId })).rejects.toThrow(/already checked out/);
    let cur = await db.asset.findUniqueOrThrow({ where: { id: a.id } });
    expect(cur).toMatchObject({ status: "LOANED", assigneeId: personId });
    await checkinAsset(admin, a.id, { toLocationId: store });
    cur = await db.asset.findUniqueOrThrow({ where: { id: a.id } });
    expect(cur).toMatchObject({ status: "IN_STOCK", assigneeId: null });
    expect((await movements(a.id)).map((m) => m.method)).toEqual(["CREATE", "CHECKOUT", "CHECKIN"]);
  });

  it("requires a wipe method to dispose PHI devices and locks disposed assets", async () => {
    const a = await createAsset(admin, { name: "Pump", typeId: medTypeId, locationId: ward, storesPhi: "on" });
    await expect(disposeAsset(admin, a.id, { disposedAt: "2026-01-01", method: "Recycle" })).rejects.toThrow(/wipe/);
    await disposeAsset(admin, a.id, { disposedAt: "2026-01-01", method: "Recycle", wipeMethod: "NIST 800-88 Purge" });
    const cur = await db.asset.findUniqueOrThrow({ where: { id: a.id }, include: { disposal: true } });
    expect(cur.status).toBe("DISPOSED");
    expect(cur.locationId).toBeNull();
    expect(cur.disposal?.wipeMethod).toBe("NIST 800-88 Purge");
    await expect(moveAssets(admin, [a.id], { toLocationId: ward, reason: "x" })).rejects.toThrow(/disposed/);
    await expect(updateAsset(admin, a.id, { name: "x", typeId: medTypeId })).rejects.toThrow(/read-only/);
  });

  it("denies writes to read-only users", async () => {
    await expect(createAsset(viewer, { name: "Nope", typeId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates custom fields against the type", async () => {
    await expect(createAsset(admin, { name: "Bad", typeId, customFields: { ram_gb: "lots" } })).rejects.toThrow(/fix the highlighted/);
  });

  it("refuses to change the append-only history", async () => {
    await expect(db.$executeRawUnsafe(`DELETE FROM "AssetMovement"`)).rejects.toThrow(/append-only/);
    await expect(db.$executeRawUnsafe(`UPDATE "AuditLog" SET summary = 'x'`)).rejects.toThrow(/append-only/);
  });
});
