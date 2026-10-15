import "server-only";
import { db } from "../db";
import { can } from "../rbac/permissions";
import type { Ctx } from "../context";
import { accessibleFolderIds } from "./vault";
import { changeNo, incidentNo, parseRecordNo } from "../lib/workflow";

export type SearchHit = { kind: string; id: string; title: string; subtitle?: string; href: string };

/** Global search across modules. Each module contributes hits the user is allowed to read. */
export async function globalSearch(ctx: Ctx, q: string, limit = 8): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const ci = { contains: term, mode: "insensitive" as const };
  const hits: SearchHit[] = [];
  const tasks: Promise<void>[] = [];

  if (can(ctx.user.role, "assets", "read")) {
    tasks.push(
      db.asset
        .findMany({
          where: {
            deletedAt: null,
            OR: [{ tag: ci }, { name: ci }, { serial: ci }, { hostname: ci }, { ipAddress: { startsWith: term } }, { macAddress: ci }],
          },
          include: { type: true },
          take: limit,
          orderBy: { tag: "asc" },
        })
        .then((rows) => {
          for (const a of rows)
            hits.push({ kind: "Asset", id: a.id, title: `${a.tag} · ${a.name}`, subtitle: [a.type.name, a.serial, a.hostname].filter(Boolean).join(" · "), href: `/assets/${a.id}` });
        }),
    );
  }
  if (can(ctx.user.role, "locations", "read")) {
    tasks.push(
      db.location.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { code: ci }] }, take: limit }).then((rows) => {
        for (const l of rows) hits.push({ kind: "Location", id: l.id, title: l.name, subtitle: l.type, href: `/locations/${l.id}` });
      }),
    );
  }
  if (can(ctx.user.role, "people", "read")) {
    tasks.push(
      db.person.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { email: ci }, { employeeId: ci }] }, take: limit }).then((rows) => {
        for (const p of rows) hits.push({ kind: "Person", id: p.id, title: p.name, subtitle: p.email ?? undefined, href: `/people/${p.id}` });
      }),
    );
  }
  if (can(ctx.user.role, "vault", "read")) {
    // Titles / usernames only, and only from folders this user may open
    tasks.push(
      accessibleFolderIds(ctx).then((folderIds) =>
        db.credential
          .findMany({
            where: { deletedAt: null, folderId: { in: folderIds }, OR: [{ title: ci }, { username: ci }, { url: ci }] },
            select: { id: true, title: true, username: true },
            take: limit,
          })
          .then((rows) => {
            for (const c of rows) hits.push({ kind: "Credential", id: c.id, title: c.title, subtitle: c.username ?? undefined, href: `/vault/${c.id}` });
          }),
      ),
    );
  }
  if (can(ctx.user.role, "kb", "read")) {
    // Drafts and templates only for people who can edit the KB
    const draftsOk = can(ctx.user.role, "kb", "write");
    tasks.push(
      db.article
        .findMany({
          where: {
            deletedAt: null,
            ...(draftsOk ? {} : { isTemplate: false, status: { not: "DRAFT" } }),
            OR: [{ title: ci }, { tags: { has: term.toLowerCase() } }, { body: ci }],
          },
          select: { id: true, title: true, status: true, isTemplate: true, tags: true },
          orderBy: { updatedAt: "desc" },
          take: limit,
        })
        .then((rows) => {
          rows.sort((a, b) => Number(b.title.toLowerCase().includes(term.toLowerCase())) - Number(a.title.toLowerCase().includes(term.toLowerCase())));
          for (const a of rows)
            hits.push({
              kind: "Article",
              id: a.id,
              title: a.title,
              subtitle: [a.isTemplate ? "template" : a.status !== "PUBLISHED" ? a.status.toLowerCase() : null, ...a.tags.slice(0, 3)].filter(Boolean).join(" · ") || undefined,
              href: `/kb/${a.id}`,
            });
        }),
    );
  }
  if (can(ctx.user.role, "vendors", "read")) {
    tasks.push(
      db.vendor.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { accountNumber: ci }] }, take: limit }).then((rows) => {
        for (const v of rows) hits.push({ kind: "Vendor", id: v.id, title: v.name, subtitle: [v.supportPhone && `support ${v.supportPhone}`, v.accountNumber && `acct ${v.accountNumber}`].filter(Boolean).join(" · ") || undefined, href: `/vendors/${v.id}` });
      }),
      db.contract
        .findMany({ where: { deletedAt: null, OR: [{ title: ci }, { reference: ci }] }, include: { vendor: { select: { name: true } } }, take: limit })
        .then((rows) => {
          for (const c of rows) hits.push({ kind: "Contract", id: c.id, title: c.title, subtitle: [c.vendor.name, c.reference, c.endDate && `ends ${c.endDate.toISOString().slice(0, 10)}`].filter(Boolean).join(" · "), href: `/vendors/contracts/${c.id}` });
        }),
    );
  }
  if (can(ctx.user.role, "software", "read")) {
    tasks.push(
      db.software.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { category: ci }] }, include: { vendor: { select: { name: true } } }, take: limit }).then((rows) => {
        for (const s of rows) hits.push({ kind: "Software", id: s.id, title: s.name, subtitle: [s.vendor?.name, s.category].filter(Boolean).join(" · ") || undefined, href: `/software/${s.id}` });
      }),
      db.license
        .findMany({ where: { deletedAt: null, OR: [{ name: ci }, { poNumber: ci }] }, include: { software: { select: { name: true } } }, take: limit })
        .then((rows) => {
          for (const l of rows) hits.push({ kind: "Licence", id: l.id, title: `${l.software.name} — ${l.name}`, subtitle: l.poNumber ? `PO ${l.poNumber}` : undefined, href: `/software/licenses/${l.id}` });
        }),
    );
  }
  if (can(ctx.user.role, "changes", "read")) {
    const no = parseRecordNo(term);
    tasks.push(
      db.changeRequest
        .findMany({ where: { OR: [{ title: ci }, { ticketRef: ci }, ...(no?.kind === "change" ? [{ number: no.number }] : [])] }, select: { id: true, number: true, title: true, status: true }, orderBy: { number: "desc" }, take: limit })
        .then((rows) => {
          for (const c of rows) hits.push({ kind: "Change", id: c.id, title: `${changeNo(c.number)} · ${c.title}`, subtitle: c.status.toLowerCase().replace("_", " "), href: `/changes/${c.id}` });
        }),
      db.incident
        .findMany({ where: { OR: [{ title: ci }, { ticketRef: ci }, ...(no?.kind === "incident" ? [{ number: no.number }] : [])] }, select: { id: true, number: true, title: true, status: true, severity: true }, orderBy: { number: "desc" }, take: limit })
        .then((rows) => {
          for (const i of rows) hits.push({ kind: "Incident", id: i.id, title: `${incidentNo(i.number)} · ${i.title}`, subtitle: `${i.severity} · ${i.status.toLowerCase()}`, href: `/changes/incidents/${i.id}` });
        }),
      db.journalEntry
        .findMany({ where: { deletedAt: null, OR: [{ text: ci }, { tags: { has: term.toLowerCase() } }] }, select: { id: true, text: true, at: true, authorName: true }, orderBy: { at: "desc" }, take: limit })
        .then((rows) => {
          const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          for (const e of rows) hits.push({ kind: "Journal", id: e.id, title: e.text.slice(0, 90), subtitle: `${e.authorName} · ${day(e.at)}`, href: `/changes/journal?day=${day(e.at)}#e-${e.id}` });
        }),
    );
  }
  if (can(ctx.user.role, "network", "read")) {
    const ipPrefix = /^[\d.]+$/.test(term);
    tasks.push(
      db.subnet.findMany({ where: { OR: [{ name: ci }, { cidr: { startsWith: term } }] }, include: { vlan: true }, take: limit }).then((rows) => {
        for (const s of rows) hits.push({ kind: "Subnet", id: s.id, title: `${s.cidr} · ${s.name}`, subtitle: s.vlan ? `VLAN ${s.vlan.number} ${s.vlan.name}` : undefined, href: `/network/subnets/${s.id}` });
      }),
      db.ipAddress
        .findMany({
          where: { OR: [...(ipPrefix ? [{ address: { startsWith: term } }] : []), { hostname: ci }, { macAddress: ci }] },
          include: { subnet: { select: { id: true, cidr: true } } },
          take: limit,
        })
        .then((rows) => {
          for (const a of rows)
            hits.push({ kind: "IP address", id: a.id, title: a.address, subtitle: [a.hostname, a.subnet.cidr, a.status.toLowerCase()].filter(Boolean).join(" · "), href: `/network/subnets/${a.subnet.id}?ip=${a.address}` });
        }),
      db.vlan
        .findMany({ where: { OR: [{ name: ci }, { purpose: ci }, ...(/^\d{1,4}$/.test(term) ? [{ number: Number(term) }] : [])] }, take: limit })
        .then((rows) => {
          for (const v of rows) hits.push({ kind: "VLAN", id: v.id, title: `VLAN ${v.number} · ${v.name}`, subtitle: v.purpose ?? undefined, href: `/network?tab=vlans&edit=${v.id}` });
        }),
      db.rack.findMany({ where: { name: ci }, include: { location: true }, take: limit }).then((rows) => {
        for (const r of rows) hits.push({ kind: "Rack", id: r.id, title: r.name, subtitle: [r.location?.name, `${r.heightU}U`].filter(Boolean).join(" · "), href: `/network/racks/${r.id}` });
      }),
      db.switchPort
        .findMany({ where: { OR: [{ wallJack: ci }, { patchPanelPort: ci }, { description: ci }] }, include: { switch: { select: { tag: true } } }, take: limit })
        .then((rows) => {
          for (const p of rows)
            hits.push({ kind: "Switch port", id: p.id, title: `${p.switch.tag} ${p.name}`, subtitle: [p.wallJack && `jack ${p.wallJack}`, p.patchPanelPort && `panel ${p.patchPanelPort}`, p.description].filter(Boolean).join(" · "), href: `/network?tab=ports&switchId=${p.switchId}&edit=${p.id}` });
        }),
      db.wifiNetwork.findMany({ where: { ssid: ci }, take: limit }).then((rows) => {
        for (const w of rows) hits.push({ kind: "Wi-Fi", id: w.id, title: w.ssid, subtitle: w.auth.replace("_", " "), href: `/network?tab=wifi&edit=${w.id}` });
      }),
    );
  }
  await Promise.all(tasks);
  return hits;
}
