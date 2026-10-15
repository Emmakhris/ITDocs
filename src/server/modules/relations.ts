import "server-only";
import { db } from "../db";
import { can, type Module } from "../rbac/permissions";
import { NotFoundError } from "../lib/errors";
import { changeNo, incidentNo } from "../lib/workflow";
import { accessibleFolderIds } from "./vault";
import type { Ctx } from "../context";

// Relationship map: one record and everything directly connected to it, across modules.
// Each node type is only included if the viewer can read that module (and, for credentials,
// the vault folder). Clicking a node re-centres the map on it.

export const NODE_TYPES = ["Asset", "Location", "Person", "Vendor", "Contract", "Software", "License", "Article", "Change", "Incident", "Subnet", "Diagram", "Credential"] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export type MapNode = { key: string; type: NodeType; id: string; label: string; sub?: string; href: string };
export type MapEdge = { to: string; label: string };

const MODULE: Record<NodeType, Module> = {
  Asset: "assets",
  Location: "locations",
  Person: "people",
  Vendor: "vendors",
  Contract: "vendors",
  Software: "software",
  License: "software",
  Article: "kb",
  Change: "changes",
  Incident: "changes",
  Subnet: "network",
  Diagram: "network",
  Credential: "vault",
};

const HREF: Record<NodeType, (id: string) => string> = {
  Asset: (id) => `/assets/${id}`,
  Location: (id) => `/locations/${id}`,
  Person: (id) => `/people/${id}`,
  Vendor: (id) => `/vendors/${id}`,
  Contract: (id) => `/vendors/contracts/${id}`,
  Software: (id) => `/software/${id}`,
  License: (id) => `/software/licenses/${id}`,
  Article: (id) => `/kb/${id}`,
  Change: (id) => `/changes/${id}`,
  Incident: (id) => `/changes/incidents/${id}`,
  Subnet: (id) => `/network/subnets/${id}`,
  Diagram: (id) => `/diagrams/${id}`,
  Credential: (id) => `/vault/${id}`,
};

const node = (type: NodeType, id: string, label: string, sub?: string | null): MapNode => ({ key: `${type}:${id}`, type, id, label, sub: sub ?? undefined, href: HREF[type](id) });
const LIMIT = 25;

/** EntityLink rows in either direction for a record, grouped by the other side's type. */
async function links(type: string, id: string) {
  const [out, inc] = await Promise.all([
    db.entityLink.findMany({ where: { fromType: type, fromId: id }, select: { toType: true, toId: true, kind: true } }),
    db.entityLink.findMany({ where: { toType: type, toId: id }, select: { fromType: true, fromId: true, kind: true } }),
  ]);
  return [...out.map((l) => ({ type: l.toType, id: l.toId, kind: l.kind })), ...inc.map((l) => ({ type: l.fromType, id: l.fromId, kind: l.kind }))];
}

const KIND_LABEL: Record<string, string> = { documents: "documents", covers: "covers", affects: "affects", depicts: "shows", credential_for: "login for" };
const linkType = (t: string): NodeType | null => (t === "ChangeRequest" ? "Change" : (NODE_TYPES as readonly string[]).includes(t) ? (t as NodeType) : null);

/** Resolves linked records of any supported type into nodes (deleted records are skipped). */
async function resolve(ctx: Ctx, items: { type: string; id: string; kind: string }[]) {
  const by = (t: NodeType) => items.filter((i) => linkType(i.type) === t).map((i) => i.id).slice(0, LIMIT);
  const out: (MapNode & { edge: string })[] = [];
  const add = (t: NodeType, rows: { id: string; label: string; sub?: string | null }[]) => {
    for (const r of rows) out.push({ ...node(t, r.id, r.label, r.sub), edge: KIND_LABEL[items.find((i) => i.id === r.id)?.kind ?? ""] ?? "related" });
  };
  const ok = (t: NodeType) => can(ctx.user.role, MODULE[t], "read") && by(t).length > 0;
  const folders = ok("Credential") ? await accessibleFolderIds(ctx) : [];
  await Promise.all([
    ok("Asset") && db.asset.findMany({ where: { id: { in: by("Asset") }, deletedAt: null }, select: { id: true, tag: true, name: true } }).then((r) => add("Asset", r.map((a) => ({ id: a.id, label: a.tag, sub: a.name })))),
    ok("Location") && db.location.findMany({ where: { id: { in: by("Location") }, deletedAt: null }, select: { id: true, name: true, type: true } }).then((r) => add("Location", r.map((l) => ({ id: l.id, label: l.name, sub: l.type.toLowerCase() })))),
    ok("Contract") && db.contract.findMany({ where: { id: { in: by("Contract") }, deletedAt: null }, select: { id: true, title: true, type: true } }).then((r) => add("Contract", r.map((c) => ({ id: c.id, label: c.title, sub: c.type.toLowerCase() })))),
    ok("Article") && db.article.findMany({ where: { id: { in: by("Article") }, deletedAt: null, ...(can(ctx.user.role, "kb", "write") ? {} : { status: { not: "DRAFT" as const } }) }, select: { id: true, title: true } }).then((r) => add("Article", r.map((a) => ({ id: a.id, label: a.title })))),
    ok("Change") && db.changeRequest.findMany({ where: { id: { in: by("Change") } }, select: { id: true, number: true, title: true } }).then((r) => add("Change", r.map((c) => ({ id: c.id, label: changeNo(c.number), sub: c.title })))),
    ok("Incident") && db.incident.findMany({ where: { id: { in: by("Incident") } }, select: { id: true, number: true, title: true, severity: true } }).then((r) => add("Incident", r.map((i) => ({ id: i.id, label: incidentNo(i.number), sub: `${i.severity} ${i.title}` })))),
    ok("Diagram") && db.diagram.findMany({ where: { id: { in: by("Diagram") }, deletedAt: null }, select: { id: true, title: true } }).then((r) => add("Diagram", r.map((d) => ({ id: d.id, label: d.title })))),
    ok("Credential") && db.credential.findMany({ where: { id: { in: by("Credential") }, deletedAt: null, folderId: { in: folders } }, select: { id: true, title: true } }).then((r) => add("Credential", r.map((c) => ({ id: c.id, label: c.title })))),
  ]);
  return out;
}

export type RelationMap = { center: MapNode; neighbours: { node: MapNode; label: string }[]; hidden: number };

export async function relationsFor(ctx: Ctx, type: NodeType, id: string): Promise<RelationMap> {
  if (!NODE_TYPES.includes(type) || !can(ctx.user.role, MODULE[type], "read")) throw new NotFoundError("Record");
  const n: { node: MapNode; label: string }[] = [];
  const push = (t: NodeType, rid: string | null | undefined, label: string, edge: string, sub?: string | null) => {
    if (rid && can(ctx.user.role, MODULE[t], "read")) n.push({ node: node(t, rid, label, sub), label: edge });
  };
  const linked = async (t: string, rid: string) => {
    for (const r of await resolve(ctx, await links(t, rid))) n.push({ node: r, label: r.edge });
  };
  let center: MapNode;

  switch (type) {
    case "Asset": {
      const a = await db.asset.findFirst({
        where: { id, deletedAt: null },
        include: {
          location: true, assignee: true, type: true,
          ipAddresses: { include: { subnet: true }, take: LIMIT },
          connectedPorts: { include: { switch: { select: { id: true, tag: true } } }, take: LIMIT },
          switchPorts: { where: { connectedAssetId: { not: null } }, include: { connectedAsset: { select: { id: true, tag: true, name: true } } }, take: LIMIT },
          rackMount: { include: { rack: { include: { location: true } } } },
          licenseSeats: { include: { license: { include: { software: true } } }, take: LIMIT },
        },
      });
      if (!a) throw new NotFoundError("Asset");
      center = node("Asset", a.id, a.tag, `${a.name} · ${a.type.name}`);
      push("Location", a.location?.id, a.location?.name ?? "", "is at", a.location?.type.toLowerCase());
      push("Person", a.assignee?.id, a.assignee?.name ?? "", "assigned to");
      for (const ip of a.ipAddresses) push("Subnet", ip.subnet.id, ip.subnet.cidr, `IP ${ip.address}`, ip.subnet.name);
      for (const p of a.connectedPorts) push("Asset", p.switch.id, p.switch.tag, `patched to ${p.name}`, "switch");
      for (const p of a.switchPorts) push("Asset", p.connectedAsset!.id, p.connectedAsset!.tag, `on port ${p.name}`, p.connectedAsset!.name);
      if (a.rackMount) push("Location", a.rackMount.rack.location?.id, a.rackMount.rack.location?.name ?? "", `rack ${a.rackMount.rack.name} U${a.rackMount.positionU}`);
      for (const s of a.licenseSeats) push("License", s.license.id, s.license.software.name, "licensed", s.license.name);
      await linked("Asset", id);
      break;
    }
    case "Location": {
      const l = await db.location.findFirst({
        where: { id, deletedAt: null },
        include: {
          parent: true,
          children: { where: { deletedAt: null }, take: LIMIT },
          assets: { where: { deletedAt: null }, select: { id: true, tag: true, name: true }, take: LIMIT },
          subnets: { take: LIMIT },
          diagrams: { where: { deletedAt: null }, take: LIMIT },
          _count: { select: { assets: { where: { deletedAt: null } } } },
        },
      });
      if (!l) throw new NotFoundError("Location");
      center = node("Location", l.id, l.name, l.type.toLowerCase());
      push("Location", l.parent?.id, l.parent?.name ?? "", "inside", l.parent?.type.toLowerCase());
      for (const c of l.children) push("Location", c.id, c.name, "contains", c.type.toLowerCase());
      for (const a of l.assets) push("Asset", a.id, a.tag, "holds", a.name);
      for (const s of l.subnets) push("Subnet", s.id, s.cidr, "network", s.name);
      for (const d of l.diagrams) push("Diagram", d.id, d.title, "diagram");
      await linked("Location", id);
      break;
    }
    case "Person": {
      const p = await db.person.findFirst({
        where: { id, deletedAt: null },
        include: { assets: { where: { deletedAt: null }, select: { id: true, tag: true, name: true }, take: LIMIT }, licenseSeats: { include: { license: { include: { software: true } } }, take: LIMIT }, department: true },
      });
      if (!p) throw new NotFoundError("Person");
      center = node("Person", p.id, p.name, p.department?.name);
      for (const a of p.assets) push("Asset", a.id, a.tag, "uses", a.name);
      for (const s of p.licenseSeats) push("License", s.license.id, s.license.software.name, "licensed", s.license.name);
      break;
    }
    case "Vendor": {
      const v = await db.vendor.findFirst({ where: { id, deletedAt: null }, include: { contracts: { where: { deletedAt: null }, take: LIMIT }, software: { where: { deletedAt: null }, take: LIMIT } } });
      if (!v) throw new NotFoundError("Vendor");
      center = node("Vendor", v.id, v.name, v.supportPhone ? `support ${v.supportPhone}` : null);
      for (const c of v.contracts) push("Contract", c.id, c.title, "contract", c.type.toLowerCase());
      for (const s of v.software) push("Software", s.id, s.name, "publishes", s.category);
      break;
    }
    case "Contract": {
      const c = await db.contract.findFirst({ where: { id, deletedAt: null }, include: { vendor: true, licenses: { where: { deletedAt: null }, include: { software: true } } } });
      if (!c) throw new NotFoundError("Contract");
      center = node("Contract", c.id, c.title, c.type.toLowerCase());
      push("Vendor", c.vendor.id, c.vendor.name, "with");
      for (const l of c.licenses) push("License", l.id, l.software.name, "includes", l.name);
      await linked("Contract", id);
      break;
    }
    case "Software": {
      const s = await db.software.findFirst({ where: { id, deletedAt: null }, include: { vendor: true, licenses: { where: { deletedAt: null } } } });
      if (!s) throw new NotFoundError("Software");
      center = node("Software", s.id, s.name, s.category);
      push("Vendor", s.vendor?.id, s.vendor?.name ?? "", "from");
      for (const l of s.licenses) push("License", l.id, l.name, "licence", l.seatBasis.toLowerCase());
      break;
    }
    case "License": {
      const l = await db.license.findFirst({
        where: { id, deletedAt: null },
        include: { software: true, contract: true, vendor: true, assignments: { include: { asset: { select: { id: true, tag: true, name: true } }, person: { select: { id: true, name: true } } }, take: LIMIT } },
      });
      if (!l) throw new NotFoundError("Licence");
      center = node("License", l.id, l.software.name, l.name);
      push("Software", l.software.id, l.software.name, "of");
      push("Contract", l.contract?.deletedAt ? null : l.contract?.id, l.contract?.title ?? "", "under");
      push("Vendor", l.vendor?.id, l.vendor?.name ?? "", "bought from");
      for (const a of l.assignments) {
        if (a.asset) push("Asset", a.asset.id, a.asset.tag, "seat", a.asset.name);
        if (a.person) push("Person", a.person.id, a.person.name, "seat");
      }
      break;
    }
    case "Article": {
      const a = await db.article.findFirst({ where: { id, deletedAt: null, ...(can(ctx.user.role, "kb", "write") ? {} : { status: { not: "DRAFT" }, isTemplate: false }) }, include: { category: true } });
      if (!a) throw new NotFoundError("Article");
      center = node("Article", a.id, a.title, a.category?.name);
      await linked("Article", id);
      break;
    }
    case "Change": {
      const c = await db.changeRequest.findUnique({ where: { id }, include: { incidents: true } });
      if (!c) throw new NotFoundError("Change");
      center = node("Change", c.id, changeNo(c.number), c.title);
      for (const i of c.incidents) push("Incident", i.id, incidentNo(i.number), "caused", `${i.severity} ${i.title}`);
      await linked("Change", id);
      break;
    }
    case "Incident": {
      const i = await db.incident.findUnique({ where: { id }, include: { causedByChange: true } });
      if (!i) throw new NotFoundError("Incident");
      center = node("Incident", i.id, incidentNo(i.number), `${i.severity} ${i.title}`);
      push("Change", i.causedByChange?.id, i.causedByChange ? changeNo(i.causedByChange.number) : "", "caused by", i.causedByChange?.title);
      await linked("Incident", id);
      break;
    }
    case "Subnet": {
      const s = await db.subnet.findUnique({ where: { id }, include: { location: true, addresses: { where: { assetId: { not: null } }, include: { asset: { select: { id: true, tag: true, name: true } } }, take: LIMIT } } });
      if (!s) throw new NotFoundError("Subnet");
      center = node("Subnet", s.id, s.cidr, s.name);
      push("Location", s.location?.id, s.location?.name ?? "", "at");
      for (const ip of s.addresses) push("Asset", ip.asset!.id, ip.asset!.tag, ip.address, ip.asset!.name);
      break;
    }
    case "Diagram": {
      const d = await db.diagram.findFirst({ where: { id, deletedAt: null }, include: { location: true } });
      if (!d) throw new NotFoundError("Diagram");
      center = node("Diagram", d.id, d.title, d.kind.toLowerCase().replace("_", " "));
      push("Location", d.location?.id, d.location?.name ?? "", "of");
      await linked("Diagram", id);
      break;
    }
    case "Credential": {
      const c = await db.credential.findFirst({ where: { id, deletedAt: null, folderId: { in: await accessibleFolderIds(ctx) } }, include: { wifiNetworks: true, contracts: { where: { deletedAt: null } } } });
      if (!c) throw new NotFoundError("Credential");
      center = node("Credential", c.id, c.title, c.username);
      for (const k of c.contracts) push("Contract", k.id, k.title, "portal login for");
      await linked("Credential", id);
      break;
    }
  }

  // De-duplicate (the same record can be reached two ways) and cap for readability
  const seen = new Set<string>([center!.key]);
  const neighbours = n.filter((x) => x.node.label && !seen.has(x.node.key) && seen.add(x.node.key));
  const MAX = 40;
  return { center: center!, neighbours: neighbours.slice(0, MAX), hidden: Math.max(0, neighbours.length - MAX) };
}

/** Lays nodes out in a circle around the centre, grouped by type. */
export function layout(m: RelationMap, size = 760) {
  const c = size / 2;
  const groups = [...m.neighbours].sort((a, b) => NODE_TYPES.indexOf(a.node.type) - NODE_TYPES.indexOf(b.node.type));
  const r = groups.length > 16 ? size * 0.4 : size * 0.33;
  return groups.map((g, i) => {
    const angle = (i / Math.max(1, groups.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...g, x: c + Math.cos(angle) * r, y: c + Math.sin(angle) * r, angle };
  });
}
