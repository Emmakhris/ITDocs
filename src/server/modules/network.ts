import "server-only";
import { z } from "zod";
import { IpStatus, PortMode, PortStatus, Prisma, WifiAuth, type Rack, type Subnet, type SwitchPort, type Vlan, type WifiNetwork } from "@prisma/client";
import { db, type Tx } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { checkbox, nulls, optNum, optStr } from "../lib/forms";
import { compareIp, findOverlap, formatIp, inRange, inSubnet, isHostAddress, nextFreeIp, parseCidr, parseIp, type Cidr } from "../lib/ip";
import { accessibleFolderIds } from "./vault";
import type { Ctx } from "../context";

// IPv4 IPAM, VLANs, racks, switch ports and Wi-Fi. Every write checks "network" write permission
// and records an audit entry in the same transaction as the change.

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const reqInt = (min: number, max: number, label: string) =>
  optNum.refine((n) => n !== undefined, `${label} is required`).refine((n) => n === undefined || (Number.isInteger(n) && n >= min && n <= max), `${label} must be ${min}–${max}`).transform((n) => n as number);
const optIp = optStr(15).refine((s) => !s || parseIp(s) !== null, "Not a valid IPv4 address");

// ───────────────────────────── Input schemas ─────────────────────────────

export const vlanInput = z.object({
  number: reqInt(1, 4094, "VLAN ID"),
  name: z.string().trim().min(1, "Name is required").max(80),
  locationId: optStr(40),
  purpose: optStr(300),
  notes: optStr(4000),
});

export const subnetInput = z.object({
  cidr: z.string().trim().min(1, "Network is required").max(18),
  name: z.string().trim().min(1, "Name is required").max(120),
  vlanId: optStr(40),
  locationId: optStr(40),
  gateway: optIp,
  dhcpStart: optIp,
  dhcpEnd: optIp,
  dns: optStr(200),
  notes: optStr(4000),
});

export const ipInput = z.object({
  address: z.string().trim().min(1, "Address is required").max(15),
  status: z.nativeEnum(IpStatus).default("ASSIGNED"),
  hostname: optStr(120),
  macAddress: optStr(40),
  assetId: optStr(40),
  notes: optStr(1000),
});

export const rackInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  locationId: optStr(40),
  heightU: reqInt(1, 60, "Height"),
  notes: optStr(4000),
});

export const mountInput = z.object({
  assetId: optStr(40),
  label: optStr(80),
  positionU: reqInt(1, 60, "Position"),
  heightU: reqInt(1, 20, "Height"),
});

const VLAN_LIST = /^\s*\d{1,4}(\s*-\s*\d{1,4})?(\s*,\s*\d{1,4}(\s*-\s*\d{1,4})?)*\s*$/;
export const portInput = z.object({
  switchId: z.string().min(1, "Switch is required"),
  name: z.string().trim().min(1, "Port name is required").max(40),
  description: optStr(200),
  connectedAssetId: optStr(40),
  patchPanelPort: optStr(60),
  wallJack: optStr(60),
  vlanId: optStr(40),
  mode: z.nativeEnum(PortMode).default("ACCESS"),
  allowedVlans: optStr(200).refine((s) => !s || VLAN_LIST.test(s), "Use a list like 10,20,100-110"),
  status: z.nativeEnum(PortStatus).default("ACTIVE"),
});

export const bulkPortInput = z.object({
  switchId: z.string().min(1, "Switch is required"),
  prefix: z.string().trim().min(1, "Prefix is required").max(30),
  from: reqInt(0, 999, "From"),
  to: reqInt(0, 999, "To"),
  vlanId: optStr(40),
});

export const wifiInput = z.object({
  ssid: z.string().trim().min(1, "SSID is required").max(32, "SSIDs are at most 32 characters"),
  auth: z.nativeEnum(WifiAuth).default("WPA2_ENTERPRISE"),
  vlanId: optStr(40),
  credentialId: optStr(40),
  locationId: optStr(40),
  hidden: checkbox,
  notes: optStr(4000),
});

async function saveRow<T extends { id: string }>(
  ctx: Ctx,
  entityType: string,
  id: string | null,
  label: (row: T) => string,
  ops: { load: (tx: Tx) => PromiseLike<T | null>; create: (tx: Tx) => PromiseLike<T>; update: (tx: Tx) => PromiseLike<T> },
): Promise<T> {
  return db.$transaction(async (tx) => {
    if (!id) {
      const row = await ops.create(tx);
      await audit(tx, ctx, { action: "create", entityType, entityId: row.id, summary: `Created ${entityType} ${label(row)}`, after: row });
      return row;
    }
    const before = await ops.load(tx);
    if (!before) throw new NotFoundError(entityType);
    const after = await ops.update(tx);
    const d = diff(before, after);
    if (d.changed.length)
      await audit(tx, ctx, { action: "update", entityType, entityId: id, summary: `Updated ${entityType} ${label(after)}`, before: d.before, after: d.after });
    return after;
  });
}

async function deleteRow(ctx: Ctx, entityType: string, id: string, run: (tx: Tx) => Promise<{ label: string; before: unknown }>) {
  assertCan(ctx.user.role, "network", "write");
  await db.$transaction(async (tx) => {
    const { label, before } = await run(tx);
    await audit(tx, ctx, { action: "delete", entityType, entityId: id, summary: `Deleted ${entityType} ${label}`, before });
  });
}

async function assertAsset(tx: Tx | typeof db, id: string | undefined, field: string) {
  if (!id) return null;
  const a = await tx.asset.findFirst({ where: { id, deletedAt: null }, select: { id: true, tag: true, name: true } });
  if (!a) throw new FieldError({ [field]: "Asset not found" });
  return a;
}

export const vlanLabel = (v: { number: number; name: string }) => `${v.number} · ${v.name}`;

// ───────────────────────────── VLANs ─────────────────────────────

export async function listVlans(ctx: Ctx) {
  assertCan(ctx.user.role, "network", "read");
  return db.vlan.findMany({
    include: { location: { select: { id: true, name: true } }, _count: { select: { subnets: true, switchPorts: true, wifiNetworks: true } } },
    orderBy: [{ number: "asc" }, { name: "asc" }],
  });
}

export async function saveVlan(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const data = nulls(vlanInput, vlanInput.parse(input));
  const clash = await db.vlan.findFirst({ where: { number: data.number, locationId: data.locationId, ...(id ? { NOT: { id } } : {}) } });
  if (clash) throw new FieldError({ number: `VLAN ${data.number} already exists ${data.locationId ? "at this site" : "without a site"} (${clash.name})` });
  try {
    return await saveRow<Vlan>(ctx, "Vlan", id, vlanLabel, {
      load: (tx) => tx.vlan.findUnique({ where: { id: id! } }),
      create: (tx) => tx.vlan.create({ data }),
      update: (tx) => tx.vlan.update({ where: { id: id! }, data }),
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ number: `VLAN ${data.number} already exists at this site` });
    throw e;
  }
}

export async function deleteVlan(ctx: Ctx, id: string) {
  await deleteRow(ctx, "Vlan", id, async (tx) => {
    const v = await tx.vlan.delete({ where: { id } });
    return { label: vlanLabel(v), before: v };
  });
}

// ───────────────────────────── Subnets ─────────────────────────────

export type SubnetUsage = { total: number; used: number; assigned: number; reserved: number; dhcp: number; pool: number };

function usageOf(c: Cidr, s: { dhcpStart: string | null; dhcpEnd: string | null }, counts: Partial<Record<IpStatus, number>>): SubnetUsage {
  const total = c.lastHost - c.firstHost + 1;
  const ds = s.dhcpStart ? parseIp(s.dhcpStart) : null;
  const de = s.dhcpEnd ? parseIp(s.dhcpEnd) : null;
  const pool = ds !== null && de !== null ? de - ds + 1 : 0;
  const assigned = counts.ASSIGNED ?? 0;
  const reserved = counts.RESERVED ?? 0;
  const dhcp = counts.DHCP ?? 0;
  return { total, assigned, reserved, dhcp, pool, used: assigned + reserved + dhcp };
}

export async function listSubnets(ctx: Ctx, f: { q?: string; vlanId?: string } = {}) {
  assertCan(ctx.user.role, "network", "read");
  const where: Prisma.SubnetWhereInput = {};
  if (f.vlanId) where.vlanId = f.vlanId;
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { cidr: { startsWith: f.q } }, { notes: { contains: f.q, mode: "insensitive" } }];
  const [rows, counts] = await Promise.all([
    db.subnet.findMany({ where, include: { vlan: true, location: { select: { id: true, name: true } } } }),
    db.ipAddress.groupBy({ by: ["subnetId", "status"], _count: true }),
  ]);
  return rows
    .map((s) => {
      const c = parseCidr(s.cidr);
      const mine = Object.fromEntries(counts.filter((x) => x.subnetId === s.id).map((x) => [x.status, x._count]));
      return { ...s, prefix: c.prefix, network: c.network, usage: usageOf(c, s, mine) };
    })
    .sort((a, b) => a.network - b.network || a.prefix - b.prefix);
}

export async function getSubnet(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "network", "read");
  const s = await db.subnet.findUnique({
    where: { id },
    include: { vlan: true, location: { select: { id: true, name: true } }, addresses: { include: { asset: { select: { id: true, tag: true, name: true } } } } },
  });
  if (!s) throw new NotFoundError("Subnet");
  const c = parseCidr(s.cidr);
  s.addresses.sort((a, b) => compareIp(a.address, b.address));
  const counts: Partial<Record<IpStatus, number>> = {};
  for (const a of s.addresses) counts[a.status] = (counts[a.status] ?? 0) + 1;
  return { ...s, info: c, usage: usageOf(c, s, counts), nextFree: nextFreeIp(c, s.addresses.map((a) => a.address), s) };
}

/** Validates a subnet's own settings and that it doesn't overlap any other subnet. */
async function checkSubnet(id: string | null, d: z.output<typeof subnetInput>) {
  let c: Cidr;
  try {
    c = parseCidr(d.cidr);
  } catch (e) {
    throw new FieldError({ cidr: (e as Error).message });
  }
  if (c.prefix < 16) throw new FieldError({ cidr: "Subnets larger than a /16 are not supported — split it into smaller networks." });
  const errs: Record<string, string> = {};
  for (const k of ["gateway", "dhcpStart", "dhcpEnd"] as const) {
    const v = d[k];
    if (v && !isHostAddress(v, c)) errs[k] = `Must be a host address inside ${c.cidr}`;
  }
  if (!!d.dhcpStart !== !!d.dhcpEnd) errs[d.dhcpStart ? "dhcpEnd" : "dhcpStart"] = "Give both ends of the DHCP range";
  else if (d.dhcpStart && d.dhcpEnd && !errs.dhcpStart && !errs.dhcpEnd) {
    if (parseIp(d.dhcpStart)! > parseIp(d.dhcpEnd)!) errs.dhcpEnd = "End must not be before start";
    else if (d.gateway && inRange(d.gateway, d.dhcpStart, d.dhcpEnd)) errs.gateway = "Gateway is inside the DHCP range";
  }
  if (d.dns && d.dns.split(",").some((x) => parseIp(x.trim()) === null)) errs.dns = "Comma-separated IPv4 addresses";
  if (Object.keys(errs).length) throw new FieldError(errs);

  const others = await db.subnet.findMany({ where: id ? { NOT: { id } } : {}, select: { cidr: true, name: true } });
  const hit = findOverlap(c, others);
  if (hit) throw new FieldError({ cidr: `Overlaps ${hit.cidr} (${hit.name})` });
  if (id) {
    const outside = (await db.ipAddress.findMany({ where: { subnetId: id }, select: { address: true } })).filter((a) => !inSubnet(a.address, c));
    if (outside.length) throw new FieldError({ cidr: `${outside.length} recorded address(es), e.g. ${outside[0].address}, would fall outside ${c.cidr}` });
  }
  return { ...d, cidr: c.cidr, dns: d.dns?.split(",").map((x) => x.trim()).join(", ") };
}

export async function saveSubnet(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const data = nulls(subnetInput, await checkSubnet(id, subnetInput.parse(input)));
  try {
    return await saveRow<Subnet>(ctx, "Subnet", id, (s) => `${s.cidr} (${s.name})`, {
      load: (tx) => tx.subnet.findUnique({ where: { id: id! } }),
      create: (tx) => tx.subnet.create({ data }),
      update: (tx) => tx.subnet.update({ where: { id: id! }, data }),
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ cidr: "That network already exists" });
    throw e;
  }
}

export async function deleteSubnet(ctx: Ctx, id: string) {
  await deleteRow(ctx, "Subnet", id, async (tx) => {
    const s = await tx.subnet.findUnique({ where: { id }, include: { addresses: true } });
    if (!s) throw new NotFoundError("Subnet");
    await tx.subnet.delete({ where: { id } }); // address records cascade; kept in the audit entry below
    const { addresses, ...rest } = s;
    return { label: `${s.cidr} (${s.name})`, before: { ...rest, addresses: addresses.map((a) => ({ address: a.address, status: a.status, hostname: a.hostname, assetId: a.assetId })) } };
  });
}

// ───────────────────────────── IP addresses ─────────────────────────────

async function checkIp(tx: Tx, subnetId: string, id: string | null, d: z.output<typeof ipInput>) {
  const s = await tx.subnet.findUnique({ where: { id: subnetId } });
  if (!s) throw new NotFoundError("Subnet");
  const c = parseCidr(s.cidr);
  if (parseIp(d.address) === null) throw new FieldError({ address: "Not a valid IPv4 address" });
  if (!inSubnet(d.address, c)) throw new FieldError({ address: `Not inside ${c.cidr}` });
  if (!isHostAddress(d.address, c)) throw new FieldError({ address: "That is the network or broadcast address" });
  if (d.address === s.gateway && d.status !== "RESERVED") throw new FieldError({ address: "That is the subnet's gateway — record it as Reserved" });
  if (d.status === "ASSIGNED" && inRange(d.address, s.dhcpStart, s.dhcpEnd))
    throw new FieldError({ address: `Inside the DHCP pool (${s.dhcpStart}–${s.dhcpEnd}). Use status "DHCP reservation" or pick an address outside the pool.` });
  const clash = await tx.ipAddress.findFirst({ where: { subnetId, address: d.address, ...(id ? { NOT: { id } } : {}) } });
  if (clash) throw new FieldError({ address: `${d.address} is already recorded (${clash.status.toLowerCase()}${clash.hostname ? `, ${clash.hostname}` : ""})` });
  await assertAsset(tx, d.assetId, "assetId");
  return s;
}

export async function saveIp(ctx: Ctx, subnetId: string, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const d = ipInput.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const s = await checkIp(tx, subnetId, id, d);
      const data = nulls(ipInput, { ...d, subnetId });
      if (!id) {
        const row = await tx.ipAddress.create({ data });
        await audit(tx, ctx, { action: "create", entityType: "IpAddress", entityId: row.id, summary: `Recorded ${row.address} in ${s.cidr} as ${row.status.toLowerCase()}`, after: row });
        return row;
      }
      const before = await tx.ipAddress.findFirst({ where: { id, subnetId } });
      if (!before) throw new NotFoundError("IP address");
      const after = await tx.ipAddress.update({ where: { id }, data });
      const df = diff(before, after);
      if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "IpAddress", entityId: id, summary: `Updated ${after.address} in ${s.cidr}`, before: df.before, after: df.after });
      return after;
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ address: `${d.address} was just taken by someone else` });
    throw e;
  }
}

/**
 * Takes the lowest free address (outside the gateway and DHCP pool). Retries when a concurrent
 * allocation grabs the same address first — the (subnetId, address) unique index is the arbiter.
 */
export async function allocateNextIp(ctx: Ctx, subnetId: string, input: unknown = {}) {
  assertCan(ctx.user.role, "network", "write");
  // DHCP-status records belong inside the pool, which allocation skips — so only static statuses here
  const d = ipInput.omit({ address: true }).extend({ status: z.enum(["ASSIGNED", "RESERVED"]).default("ASSIGNED") }).parse(input);
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await db.subnet.findUnique({ where: { id: subnetId }, include: { addresses: { select: { address: true } } } });
    if (!s) throw new NotFoundError("Subnet");
    const address = nextFreeIp(s.cidr, s.addresses.map((a) => a.address), s);
    if (!address) throw new AppError(`${s.cidr} has no free addresses outside the DHCP pool.`);
    try {
      return await db.$transaction(async (tx) => {
        await assertAsset(tx, d.assetId, "assetId");
        const row = await tx.ipAddress.create({ data: nulls(ipInput, { ...d, address, subnetId }) });
        await audit(tx, ctx, { action: "allocate", entityType: "IpAddress", entityId: row.id, summary: `Allocated ${address} in ${s.cidr}${row.hostname ? ` to ${row.hostname}` : ""}`, after: row });
        return row;
      });
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  throw new AppError("Could not allocate an address — the subnet is busy. Try again.");
}

export async function releaseIp(ctx: Ctx, id: string) {
  await deleteRow(ctx, "IpAddress", id, async (tx) => {
    const ip = await tx.ipAddress.delete({ where: { id }, include: { subnet: { select: { cidr: true } } } });
    const { subnet, ...before } = ip;
    return { label: `${ip.address} (released from ${subnet.cidr})`, before };
  });
}

export type GridCell = {
  ip: string;
  last: number;
  state: "network" | "broadcast" | "gateway" | "assigned" | "reserved" | "dhcp" | "pool" | "free" | "noted";
  id?: string;
  hostname?: string | null;
};

/**
 * One block of up to 256 addresses (a /24 slice of larger subnets) for the visual IP grid.
 * `block` is the slice index; records are matched by address.
 */
export function subnetGrid(
  s: { cidr: string; gateway: string | null; dhcpStart: string | null; dhcpEnd: string | null; addresses: { id: string; address: string; status: IpStatus; hostname: string | null }[] },
  block = 0,
): { cells: GridCell[]; blocks: number; block: number; from: string; to: string } {
  const c = parseCidr(s.cidr);
  const blocks = Math.max(1, Math.ceil(c.size / 256));
  const b = Math.min(Math.max(0, block), blocks - 1);
  const start = c.network + b * 256;
  const end = Math.min(c.broadcast, start + 255);
  const byAddr = new Map(s.addresses.map((a) => [parseIp(a.address)!, a]));
  const gw = s.gateway ? parseIp(s.gateway) : null;
  const cells: GridCell[] = [];
  for (let n = start; n <= end; n++) {
    const rec = byAddr.get(n);
    let state: GridCell["state"];
    if (rec) state = rec.status === "FREE" ? "noted" : (rec.status.toLowerCase() as GridCell["state"]);
    else if (n < c.firstHost) state = "network";
    else if (n > c.lastHost) state = "broadcast";
    else if (n === gw) state = "gateway";
    else if (inRange(n, s.dhcpStart, s.dhcpEnd)) state = "pool";
    else state = "free";
    cells.push({ ip: formatIp(n), last: n & 255, state, id: rec?.id, hostname: rec?.hostname });
  }
  return { cells, blocks, block: b, from: formatIp(start), to: formatIp(end) };
}

// ───────────────────────────── Racks ─────────────────────────────

export async function listRacks(ctx: Ctx) {
  assertCan(ctx.user.role, "network", "read");
  const rows = await db.rack.findMany({ include: { location: { select: { id: true, name: true } }, mounts: { select: { heightU: true } } }, orderBy: { name: "asc" } });
  return rows.map(({ mounts, ...r }) => ({ ...r, usedU: mounts.reduce((n, m) => n + m.heightU, 0), mountCount: mounts.length }));
}

export async function getRack(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "network", "read");
  const r = await db.rack.findUnique({
    where: { id },
    include: {
      location: { select: { id: true, name: true } },
      mounts: { include: { asset: { select: { id: true, tag: true, name: true, status: true, type: { select: { name: true } } } } }, orderBy: { positionU: "desc" } },
    },
  });
  if (!r) throw new NotFoundError("Rack");
  return r;
}

export async function saveRack(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const data = nulls(rackInput, rackInput.parse(input));
  if (id) {
    const highest = (await db.rackMount.findMany({ where: { rackId: id } })).reduce((m, x) => Math.max(m, x.positionU + x.heightU - 1), 0);
    if (highest > data.heightU) throw new FieldError({ heightU: `Equipment is mounted up to U${highest}` });
  }
  return saveRow<Rack>(ctx, "Rack", id, (r) => r.name, {
    load: (tx) => tx.rack.findUnique({ where: { id: id! } }),
    create: (tx) => tx.rack.create({ data }),
    update: (tx) => tx.rack.update({ where: { id: id! }, data }),
  });
}

export async function deleteRack(ctx: Ctx, id: string) {
  await deleteRow(ctx, "Rack", id, async (tx) => {
    const r = await tx.rack.findUnique({ where: { id }, include: { mounts: true } });
    if (!r) throw new NotFoundError("Rack");
    await tx.rack.delete({ where: { id } });
    return { label: r.name, before: r };
  });
}

export async function mountInRack(ctx: Ctx, rackId: string, mountId: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const d = mountInput.parse(input);
  if (!d.assetId && !d.label) throw new FieldError({ assetId: "Choose an asset or enter a label" });
  try {
    return await db.$transaction(async (tx) => {
      const rack = await tx.rack.findUnique({ where: { id: rackId }, include: { mounts: { include: { asset: { select: { tag: true } } } } } });
      if (!rack) throw new NotFoundError("Rack");
      const top = d.positionU + d.heightU - 1;
      if (top > rack.heightU) throw new FieldError({ positionU: `Doesn't fit: would reach U${top} of a ${rack.heightU}U rack` });
      const clash = rack.mounts.find((m) => m.id !== mountId && d.positionU <= m.positionU + m.heightU - 1 && m.positionU <= top);
      if (clash) throw new FieldError({ positionU: `U${clash.positionU}${clash.heightU > 1 ? `–${clash.positionU + clash.heightU - 1}` : ""} is occupied by ${clash.asset?.tag ?? clash.label}` });
      const asset = await assertAsset(tx, d.assetId, "assetId");
      if (asset) {
        const elsewhere = await tx.rackMount.findFirst({ where: { assetId: asset.id, ...(mountId ? { NOT: { id: mountId } } : {}) }, include: { rack: true } });
        if (elsewhere) throw new FieldError({ assetId: `${asset.tag} is already mounted in ${elsewhere.rack.name} at U${elsewhere.positionU}` });
      }
      const data = { assetId: d.assetId ?? null, label: d.label ?? null, positionU: d.positionU, heightU: d.heightU };
      const what = `${asset?.tag ?? d.label} at U${d.positionU}${d.heightU > 1 ? `–${top}` : ""} in ${rack.name}`;
      if (mountId) {
        const before = rack.mounts.find((m) => m.id === mountId);
        if (!before) throw new NotFoundError("Rack position");
        const after = await tx.rackMount.update({ where: { id: mountId }, data });
        const { asset: _, ...b } = before;
        const df = diff(b, after);
        if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "Rack", entityId: rackId, summary: `Moved ${what}`, before: df.before, after: df.after });
        return after;
      }
      const row = await tx.rackMount.create({ data: { ...data, rackId } });
      await audit(tx, ctx, { action: "mount", entityType: "Rack", entityId: rackId, summary: `Mounted ${what}`, after: row });
      return row;
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ assetId: "That asset is already mounted in a rack" });
    throw e;
  }
}

export async function unmount(ctx: Ctx, mountId: string) {
  assertCan(ctx.user.role, "network", "write");
  await db.$transaction(async (tx) => {
    const m = await tx.rackMount.delete({ where: { id: mountId }, include: { rack: true, asset: { select: { tag: true } } } });
    const { rack, asset, ...before } = m;
    await audit(tx, ctx, { action: "unmount", entityType: "Rack", entityId: rack.id, summary: `Removed ${asset?.tag ?? m.label} from ${rack.name} U${m.positionU}`, before });
  });
}

// ───────────────────────────── Switch ports ─────────────────────────────

/** Assets that have ports documented, with port counts. */
export async function listSwitches(ctx: Ctx) {
  assertCan(ctx.user.role, "network", "read");
  const groups = await db.switchPort.groupBy({ by: ["switchId"], _count: true });
  const assets = await db.asset.findMany({ where: { id: { in: groups.map((g) => g.switchId) } }, select: { id: true, tag: true, name: true, hostname: true }, orderBy: { tag: "asc" } });
  return assets.map((a) => ({ ...a, ports: groups.find((g) => g.switchId === a.id)?._count ?? 0 }));
}

/** Natural sort so Gi1/0/2 comes before Gi1/0/10. */
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export async function listPorts(ctx: Ctx, f: { switchId?: string; q?: string } = {}) {
  assertCan(ctx.user.role, "network", "read");
  const where: Prisma.SwitchPortWhereInput = {};
  if (f.switchId) where.switchId = f.switchId;
  if (f.q) {
    const ci = { contains: f.q, mode: "insensitive" as const };
    where.OR = [{ name: ci }, { description: ci }, { wallJack: ci }, { patchPanelPort: ci }, { connectedAsset: { OR: [{ tag: ci }, { name: ci }, { hostname: ci }] } }];
  }
  const rows = await db.switchPort.findMany({
    where,
    include: { switch: { select: { id: true, tag: true, name: true } }, connectedAsset: { select: { id: true, tag: true, name: true } }, vlan: true },
    take: 1000,
  });
  return rows.sort((a, b) => natural.compare(a.switch.tag, b.switch.tag) || natural.compare(a.name, b.name));
}

export async function getPort(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "network", "read");
  const p = await db.switchPort.findUnique({ where: { id }, include: { switch: { select: { id: true, tag: true, name: true } }, connectedAsset: { select: { id: true, tag: true, name: true } } } });
  if (!p) throw new NotFoundError("Switch port");
  return p;
}

export async function savePort(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const d = portInput.parse(input);
  const sw = await assertAsset(db, d.switchId, "switchId");
  if (d.connectedAssetId && d.connectedAssetId === d.switchId) throw new FieldError({ connectedAssetId: "A port can't connect to its own switch" });
  await assertAsset(db, d.connectedAssetId, "connectedAssetId");
  const data = nulls(portInput, { ...d, allowedVlans: d.mode === "TRUNK" ? d.allowedVlans?.replace(/\s+/g, "") : undefined });
  try {
    return await saveRow<SwitchPort>(ctx, "SwitchPort", id, (p) => `${sw!.tag} ${p.name}`, {
      load: (tx) => tx.switchPort.findUnique({ where: { id: id! } }),
      create: (tx) => tx.switchPort.create({ data }),
      update: (tx) => tx.switchPort.update({ where: { id: id! }, data }),
    });
  } catch (e) {
    if (isUnique(e)) throw new FieldError({ name: `${sw!.tag} already has a port called ${d.name}` });
    throw e;
  }
}

/** Creates ports "<prefix><from>" … "<prefix><to>", skipping names that already exist. */
export async function bulkCreatePorts(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const d = bulkPortInput.parse(input);
  if (d.to < d.from) throw new FieldError({ to: "Must be at least From" });
  if (d.to - d.from >= 128) throw new FieldError({ to: "At most 128 ports at a time" });
  const sw = await assertAsset(db, d.switchId, "switchId");
  return db.$transaction(async (tx) => {
    const names = Array.from({ length: d.to - d.from + 1 }, (_, i) => `${d.prefix}${d.from + i}`);
    const res = await tx.switchPort.createMany({ data: names.map((name) => ({ switchId: d.switchId, name, vlanId: d.vlanId ?? null })), skipDuplicates: true });
    await audit(tx, ctx, { action: "create", entityType: "SwitchPort", entityId: d.switchId, summary: `Added ${res.count} port(s) ${names[0]}…${names.at(-1)} to ${sw!.tag}` });
    return res.count;
  });
}

export async function deletePort(ctx: Ctx, id: string) {
  await deleteRow(ctx, "SwitchPort", id, async (tx) => {
    const p = await tx.switchPort.delete({ where: { id }, include: { switch: { select: { tag: true } } } });
    const { switch: sw, ...before } = p;
    return { label: `${sw.tag} ${p.name}`, before };
  });
}

// ───────────────────────────── Wi-Fi ─────────────────────────────

export async function listWifi(ctx: Ctx) {
  assertCan(ctx.user.role, "network", "read");
  const [rows, folders] = await Promise.all([
    db.wifiNetwork.findMany({ include: { vlan: true, location: { select: { id: true, name: true } }, credential: { select: { id: true, title: true, folderId: true, deletedAt: true } } }, orderBy: { ssid: "asc" } }),
    accessibleFolderIds(ctx),
  ]);
  // Only reveal which vault entry holds the key to people who could open it
  return rows.map(({ credential, ...w }) => ({
    ...w,
    hasCredential: !!credential && !credential.deletedAt,
    credential: credential && !credential.deletedAt && folders.includes(credential.folderId) ? { id: credential.id, title: credential.title } : null,
  }));
}

export async function saveWifi(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const d = wifiInput.parse(input);
  if (d.credentialId) {
    const c = await db.credential.findFirst({ where: { id: d.credentialId, deletedAt: null }, select: { folderId: true } });
    if (!c || !(await accessibleFolderIds(ctx)).includes(c.folderId)) throw new FieldError({ credentialId: "Credential not found in a vault folder you can open" });
  } else if (id) {
    // People who can't open the linked credential never see the link, so their edit mustn't silently remove it
    const prev = await db.wifiNetwork.findUnique({ where: { id }, select: { credential: { select: { id: true, folderId: true } } } });
    if (prev?.credential && !(await accessibleFolderIds(ctx)).includes(prev.credential.folderId)) d.credentialId = prev.credential.id;
  }
  const data = nulls(wifiInput, d);
  return saveRow<WifiNetwork>(ctx, "WifiNetwork", id, (w) => w.ssid, {
    load: (tx) => tx.wifiNetwork.findUnique({ where: { id: id! } }),
    create: (tx) => tx.wifiNetwork.create({ data }),
    update: (tx) => tx.wifiNetwork.update({ where: { id: id! }, data }),
  });
}

export async function deleteWifi(ctx: Ctx, id: string) {
  await deleteRow(ctx, "WifiNetwork", id, async (tx) => {
    const w = await tx.wifiNetwork.delete({ where: { id } });
    return { label: w.ssid, before: w };
  });
}

// ───────────────────────────── Cross-module views ─────────────────────────────

/** IPs, switch ports and rack position of one asset — for the asset detail page. */
export async function assetNetwork(ctx: Ctx, assetId: string) {
  if (!can(ctx.user.role, "network", "read")) return null;
  const [ips, links, ownPorts, mount] = await Promise.all([
    db.ipAddress.findMany({ where: { assetId }, include: { subnet: { include: { vlan: true } } } }),
    db.switchPort.findMany({ where: { connectedAssetId: assetId }, include: { switch: { select: { id: true, tag: true, name: true } }, vlan: true } }),
    db.switchPort.groupBy({ by: ["status"], where: { switchId: assetId }, _count: true }),
    db.rackMount.findUnique({ where: { assetId }, include: { rack: { include: { location: { select: { id: true, name: true } } } } } }),
  ]);
  ips.sort((a, b) => compareIp(a.address, b.address));
  return { ips, links, ports: Object.fromEntries(ownPorts.map((p) => [p.status, p._count])) as Partial<Record<PortStatus, number>>, mount };
}

/** Option lists for network forms. */
export async function vlanOptions() {
  const rows = await db.vlan.findMany({ include: { location: { select: { name: true } } }, orderBy: [{ number: "asc" }, { name: "asc" }] });
  return rows.map((v) => ({ id: v.id, label: `${vlanLabel(v)}${v.location ? ` (${v.location.name})` : ""}` }));
}
