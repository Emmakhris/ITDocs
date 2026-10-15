import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import {
  allocateNextIp,
  assetNetwork,
  bulkCreatePorts,
  deleteSubnet,
  getSubnet,
  listWifi,
  mountInRack,
  releaseIp,
  saveIp,
  savePort,
  saveRack,
  saveSubnet,
  saveVlan,
  saveWifi,
  subnetGrid,
} from "@/server/modules/network";
import { globalSearch } from "@/server/modules/search";
import { createCredential, saveFolder } from "@/server/modules/vault";
import { ZodError } from "zod";
import { FieldError, ForbiddenError } from "@/server/lib/errors";

const run = Date.now().toString(36);
// Unique second octet per run so overlap checks don't trip on earlier runs' data
const o2 = (Date.now() >> 10) % 200;
const net = (third: number, last = 0) => `10.${o2}.${third}.${last}`;

const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `n-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};
const fieldErr = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(FieldError);
  return (e as FieldError).fieldErrors;
};

let admin: Ctx, tech: Ctx, viewer: Ctx;
let server: string, sw: string;

beforeAll(async () => {
  await db.subnet.deleteMany({ where: { cidr: { startsWith: `10.${o2}.` } } });
  [admin, tech, viewer] = await Promise.all([mkUser("ADMIN", "admin"), mkUser("TECHNICIAN", "tech"), mkUser("READONLY", "viewer")]);
  const type = await db.assetType.upsert({ where: { name: "Network test type" }, create: { name: "Network test type" }, update: {} });
  server = (await db.asset.create({ data: { tag: `NS-${run}`, name: "Test server", typeId: type.id } })).id;
  sw = (await db.asset.create({ data: { tag: `NW-${run}`, name: "Test switch", typeId: type.id } })).id;
});

describe("subnets", () => {
  it("normalises, validates settings and rejects overlaps", async () => {
    const s = await saveSubnet(tech, null, { cidr: net(0) + "/24", name: `Clinical ${run}`, gateway: net(0, 1), dhcpStart: net(0, 100), dhcpEnd: net(0, 199), dns: `${net(0, 10)},${net(0, 11)}` });
    expect(s.cidr).toBe(`${net(0)}/24`);
    expect(s.dns).toBe(`${net(0, 10)}, ${net(0, 11)}`);

    expect((await fieldErr(saveSubnet(tech, null, { cidr: net(0) + "/23", name: "Overlap" }))).cidr).toMatch(/Overlaps/);
    expect((await fieldErr(saveSubnet(tech, null, { cidr: net(1, 7) + "/24", name: "Host bits" }))).cidr).toMatch(/did you mean/);
    const errs = await fieldErr(saveSubnet(tech, null, { cidr: net(1) + "/24", name: "Bad", gateway: net(2, 1), dhcpStart: net(1, 50) }));
    expect(Object.keys(errs).sort()).toEqual(["dhcpEnd", "gateway"]);

    // Adjacent networks are fine
    await saveSubnet(tech, null, { cidr: net(1) + "/24", name: `Adjacent ${run}` });
  });

  it("writes an audit entry in the same transaction", async () => {
    const s = await saveSubnet(admin, null, { cidr: net(2) + "/28", name: `Audit ${run}` });
    const log = await db.auditLog.findFirst({ where: { entityType: "Subnet", entityId: s.id, action: "create" } });
    expect(log?.actorName).toBe(admin.user.displayName);
    await saveSubnet(admin, s.id, { cidr: net(2) + "/28", name: `Audit renamed ${run}` });
    const upd = await db.auditLog.findFirst({ where: { entityType: "Subnet", entityId: s.id, action: "update" } });
    expect(upd?.after).toEqual({ name: `Audit renamed ${run}` });

    // Leaving an optional field empty on edit clears it (zod drops absent keys; they must become null)
    await saveSubnet(admin, s.id, { cidr: net(2) + "/28", name: `Audit renamed ${run}`, notes: "temp", gateway: net(2, 1) });
    const cleared = await saveSubnet(admin, s.id, { cidr: net(2) + "/28", name: `Audit renamed ${run}` });
    expect([cleared.notes, cleared.gateway]).toEqual([null, null]);
  });
});

describe("IP allocation", () => {
  let subnetId: string;
  beforeAll(async () => {
    subnetId = (await saveSubnet(tech, null, { cidr: net(10) + "/29", name: `Small ${run}`, gateway: net(10, 1), dhcpStart: net(10, 5), dhcpEnd: net(10, 6) })).id;
  });

  it("validates addresses against the subnet", async () => {
    expect((await fieldErr(saveIp(tech, subnetId, null, { address: net(11, 2) }))).address).toMatch(/Not inside/);
    expect((await fieldErr(saveIp(tech, subnetId, null, { address: net(10, 0) }))).address).toMatch(/network or broadcast/);
    expect((await fieldErr(saveIp(tech, subnetId, null, { address: net(10, 1) }))).address).toMatch(/gateway/);
    expect((await fieldErr(saveIp(tech, subnetId, null, { address: net(10, 5), status: "ASSIGNED" }))).address).toMatch(/DHCP pool/);
    await saveIp(tech, subnetId, null, { address: net(10, 5), status: "DHCP", hostname: "pump-01" });
  });

  it("refuses a duplicate address and audits allocations", async () => {
    const ip = await saveIp(tech, subnetId, null, { address: net(10, 2), hostname: "srv-a", assetId: server });
    expect((await fieldErr(saveIp(tech, subnetId, null, { address: net(10, 2) }))).address).toMatch(/already recorded/);
    expect(await db.auditLog.count({ where: { entityType: "IpAddress", entityId: ip.id, action: "create" } })).toBe(1);
  });

  it("allocates next free addresses without conflicts, even concurrently, then reports full", async () => {
    // Free host addresses left: .3 and .4 (.1 gateway, .2 used, .5–.6 DHCP pool)
    const got = await Promise.all([allocateNextIp(tech, subnetId, { hostname: "a" }), allocateNextIp(tech, subnetId, { hostname: "b" })]);
    expect(got.map((g) => g.address).sort()).toEqual([net(10, 3), net(10, 4)]);
    expect(await db.auditLog.count({ where: { entityType: "IpAddress", entityId: { in: got.map((g) => g.id) }, action: "allocate" } })).toBe(2);
    await expect(allocateNextIp(tech, subnetId)).rejects.toThrow(/no free addresses/);

    await releaseIp(tech, got[0].id);
    expect((await allocateNextIp(tech, subnetId)).address).toBe(got[0].address);
  });

  it("builds the IP grid and refuses to shrink a subnet past its records", async () => {
    const s = await getSubnet(viewer, subnetId);
    const grid = subnetGrid(s);
    expect(grid.cells.map((c) => c.state)).toEqual(["network", "gateway", "assigned", "assigned", "assigned", "dhcp", "pool", "broadcast"]);
    expect(s.usage).toMatchObject({ total: 6, used: 4 });
    expect((await fieldErr(saveSubnet(tech, subnetId, { cidr: net(10) + "/30", name: "Shrunk" }))).cidr).toMatch(/outside/);
  });
});

describe("RBAC", () => {
  it("lets read-only users read but not write", async () => {
    await expect(saveVlan(viewer, null, { number: 99, name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveSubnet(viewer, null, { cidr: net(50) + "/24", name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(allocateNextIp(viewer, "whatever")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRack(viewer, null, { name: "x", heightU: 42 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteSubnet(viewer, "whatever")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await assetNetwork(viewer, server)).not.toBeNull();
    expect(await db.auditLog.count({ where: { actorId: viewer.user.id } })).toBe(0);
  });
});

describe("VLANs, racks, ports, Wi-Fi", () => {
  it("keeps VLAN numbers unique per site", async () => {
    const loc = await db.location.create({ data: { name: `Site ${run}`, type: "SITE" } });
    const n = 1000 + (Date.now() % 3000);
    await saveVlan(tech, null, { number: n, name: "Voice", locationId: loc.id });
    expect((await fieldErr(saveVlan(tech, null, { number: n, name: "Dup", locationId: loc.id }))).number).toMatch(/already exists/);
    await saveVlan(tech, null, { number: n, name: "Same number, no site" });
    expect((await fieldErr(saveVlan(tech, null, { number: n, name: "Dup, no site" }))).number).toMatch(/without a site/);
  });

  it("places equipment in racks without overlaps", async () => {
    const rack = await saveRack(tech, null, { name: `R-${run}`, heightU: 12 });
    await mountInRack(tech, rack.id, null, { assetId: server, positionU: 10, heightU: 2 });
    expect((await fieldErr(mountInRack(tech, rack.id, null, { label: "Shelf", positionU: 11, heightU: 1 }))).positionU).toMatch(/occupied/);
    expect((await fieldErr(mountInRack(tech, rack.id, null, { label: "Too tall", positionU: 12, heightU: 2 }))).positionU).toMatch(/Doesn't fit/);
    expect((await fieldErr(mountInRack(tech, rack.id, null, { assetId: server, positionU: 1, heightU: 1 }))).assetId).toMatch(/already mounted/);
    expect((await fieldErr(saveRack(tech, rack.id, { name: `R-${run}`, heightU: 10 }))).heightU).toMatch(/U11/);
    expect(await db.auditLog.count({ where: { entityType: "Rack", entityId: rack.id, action: "mount" } })).toBe(1);
  });

  it("documents switch ports and shows them on the connected asset", async () => {
    expect(await bulkCreatePorts(tech, { switchId: sw, prefix: "Gi1/0/", from: 1, to: 24 })).toBe(24);
    expect(await bulkCreatePorts(tech, { switchId: sw, prefix: "Gi1/0/", from: 20, to: 26 })).toBe(2); // existing names skipped
    const p = await savePort(tech, null, { switchId: sw, name: "Te1/1/1", connectedAssetId: server, wallJack: `WJ-${run}`, mode: "TRUNK", allowedVlans: "10, 20,100-110" });
    expect(p.allowedVlans).toBe("10,20,100-110");
    expect((await fieldErr(savePort(tech, null, { switchId: sw, name: "Te1/1/1" }))).name).toMatch(/already has/);
    await expect(savePort(tech, null, { switchId: sw, name: "x", mode: "TRUNK", allowedVlans: "ten" })).rejects.toBeInstanceOf(ZodError);

    const info = await assetNetwork(tech, server);
    expect(info?.links.map((l) => l.name)).toEqual(["Te1/1/1"]);
    expect(info?.ips.map((i) => i.address)).toContain(net(10, 2));
    expect(info?.mount?.positionU).toBe(10);

    const hits = await globalSearch(viewer, `WJ-${run}`);
    expect(hits.some((h) => h.kind === "Switch port")).toBe(true);
  });

  it("links Wi-Fi to a vault credential only for people who can open it", async () => {
    const folder = await saveFolder(admin, null, { name: `Wifi keys ${run}`, restricted: "on" });
    const cred = await createCredential(admin, { folderId: folder.id, title: `PSK ${run}`, password: "correct horse" });
    expect((await fieldErr(saveWifi(tech, null, { ssid: `Guest-${run}`, auth: "WPA2_PSK", credentialId: cred.id }))).credentialId).toBeTruthy();
    const w = await saveWifi(admin, null, { ssid: `Guest-${run}`, auth: "WPA2_PSK", credentialId: cred.id });

    const asAdmin = (await listWifi(admin)).find((x) => x.id === w.id)!;
    const asViewer = (await listWifi(viewer)).find((x) => x.id === w.id)!;
    expect(asAdmin.credential?.title).toBe(`PSK ${run}`);
    expect(asViewer.credential).toBeNull();
    expect(asViewer.hasCredential).toBe(true);

    // A technician without access to the folder edits the network: the hidden link survives
    await saveWifi(tech, w.id, { ssid: `Guest-${run}`, auth: "WPA2_PSK", notes: "edited" });
    expect((await db.wifiNetwork.findUnique({ where: { id: w.id } }))?.credentialId).toBe(cred.id);
  });
});
