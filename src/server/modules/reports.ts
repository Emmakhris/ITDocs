import "server-only";
import { AssetStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import { assertCan, can, type Module } from "../rbac/permissions";
import { AppError, NotFoundError } from "../lib/errors";
import { duration, changeNo, incidentNo } from "../lib/workflow";
import { seatUsage } from "../lib/renewals";
import type { Cell } from "../lib/xlsx";
import { locationTree } from "./locations";
import { renewals } from "./vendors";
import { listCredentials } from "./vault";
import type { Ctx } from "../context";

// Built-in reports. Each declares its parameters, the module permission it needs (on top of
// "reports"), and returns columns + rows. The same definition drives the on-screen table, CSV,
// Excel, print view and scheduled emails.

const DAY = 86_400_000;

export type ParamDef =
  | { name: string; label: string; type: "days"; options: number[]; default: number }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; default: string };

export type ReportResult = { columns: string[]; rows: Cell[][]; summary?: string };

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  category: "Inventory" | "Medical devices" | "Software & contracts" | "Operations" | "Security";
  module: Module;
  params: ParamDef[];
  run: (ctx: Ctx, p: Record<string, string | number>) => Promise<ReportResult>;
};

const statusOptions = [{ value: "", label: "Any status" }, ...Object.values(AssetStatus).map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ") }))];
const windowDays = (name: string, label: string, def: number, options = [7, 30, 60, 90, 180, 365]): ParamDef => ({ name, label, type: "days", options, default: def });
const since = (days: number) => new Date(Date.now() - days * DAY);
const until = (days: number) => new Date(Date.now() + days * DAY);
const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

async function pathMap() {
  return new Map((await locationTree()).map((l) => [l.id, l.path]));
}

export const REPORTS: ReportDef[] = [
  {
    key: "inventory",
    title: "Asset inventory",
    description: "Every asset with its location, assignee, purchase and warranty details.",
    category: "Inventory",
    module: "assets",
    params: [{ name: "status", label: "Status", type: "select", options: statusOptions, default: "" }],
    async run(_, p) {
      const [rows, paths] = await Promise.all([
        db.asset.findMany({
          where: { deletedAt: null, ...(p.status ? { status: p.status as AssetStatus } : {}) },
          include: { type: { select: { name: true } }, assignee: { select: { name: true } }, department: { select: { name: true } } },
          orderBy: { tag: "asc" },
        }),
        pathMap(),
      ]);
      const cost = rows.reduce((n, a) => n + (num(a.purchaseCost) ?? 0), 0);
      return {
        columns: ["Tag", "Name", "Type", "Status", "Manufacturer", "Model", "Serial", "Hostname", "Location", "Assigned to", "Department", "Purchased", "Cost", "Warranty end"],
        rows: rows.map((a) => [a.tag, a.name, a.type.name, a.status, a.manufacturer, a.model, a.serial, a.hostname, a.locationId ? paths.get(a.locationId) : null, a.assignee?.name, a.department?.name, a.purchaseDate, num(a.purchaseCost), a.warrantyEnd]),
        summary: `${rows.length} assets · total purchase cost ${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      };
    },
  },
  {
    key: "assets-by-location",
    title: "Assets by location",
    description: "How many assets are at each location, split by status.",
    category: "Inventory",
    module: "assets",
    params: [],
    async run() {
      const [groups, tree] = await Promise.all([db.asset.groupBy({ by: ["locationId", "status"], where: { deletedAt: null }, _count: true }), locationTree()]);
      const statuses = Object.values(AssetStatus);
      const byLoc = new Map<string | null, Record<string, number>>();
      for (const g of groups) {
        const r = byLoc.get(g.locationId) ?? {};
        r[g.status] = g._count;
        byLoc.set(g.locationId, r);
      }
      const rows: Cell[][] = tree.filter((l) => byLoc.has(l.id)).map((l) => {
        const r = byLoc.get(l.id)!;
        return [l.path, ...statuses.map((s) => r[s] ?? 0), statuses.reduce((n, s) => n + (r[s] ?? 0), 0)];
      });
      const none = byLoc.get(null);
      if (none) rows.push(["(no location)", ...statuses.map((s) => none[s] ?? 0), statuses.reduce((n, s) => n + (none[s] ?? 0), 0)]);
      return { columns: ["Location", ...statuses.map((s) => s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ")), "Total"], rows };
    },
  },
  {
    key: "warranty",
    title: "Warranties ending",
    description: "Live assets whose warranty ends within the chosen window (and those already expired in it).",
    category: "Inventory",
    module: "assets",
    params: [windowDays("days", "Ending within", 90)],
    async run(_, p) {
      const days = Number(p.days);
      const [rows, paths] = await Promise.all([
        db.asset.findMany({
          where: { deletedAt: null, status: { notIn: ["DISPOSED", "RETIRED"] }, warrantyEnd: { gte: since(days), lte: until(days) } },
          include: { type: { select: { name: true } } },
          orderBy: { warrantyEnd: "asc" },
        }),
        pathMap(),
      ]);
      const now = Date.now();
      return {
        columns: ["Tag", "Name", "Type", "Status", "Vendor", "Warranty end", "Days left", "Location"],
        rows: rows.map((a) => [a.tag, a.name, a.type.name, a.status, a.vendorName, a.warrantyEnd, Math.ceil((a.warrantyEnd!.getTime() - now) / DAY), a.locationId ? paths.get(a.locationId) : null]),
        summary: `${rows.filter((a) => a.warrantyEnd!.getTime() >= now).length} ending, ${rows.filter((a) => a.warrantyEnd!.getTime() < now).length} already expired`,
      };
    },
  },
  {
    key: "movements",
    title: "Movements by period",
    description: "Every location, assignee or status change recorded in the movement log.",
    category: "Inventory",
    module: "assets",
    params: [windowDays("days", "In the last", 30, [1, 7, 30, 90, 365])],
    async run(_, p) {
      const rows = await db.assetMovement.findMany({
        where: { movedAt: { gte: since(Number(p.days)) } },
        include: { asset: { select: { tag: true, name: true } } },
        orderBy: { movedAt: "desc" },
        take: 20_000,
      });
      return {
        columns: ["When", "Tag", "Asset", "Method", "From", "To", "From person", "To person", "From status", "To status", "Reason", "Ticket", "By"],
        rows: rows.map((m) => [m.movedAt, m.asset.tag, m.asset.name, m.method, m.fromLocationPath, m.toLocationPath, m.fromAssignee, m.toAssignee, m.fromStatus, m.toStatus, m.reason, m.ticketRef, m.movedByName]),
        summary: `${rows.length} movements`,
      };
    },
  },
  {
    key: "phi-devices",
    title: "PHI-storing devices",
    description: "Devices flagged as storing patient data, with network segmentation and maintenance status — for HIPAA risk assessments.",
    category: "Medical devices",
    module: "assets",
    params: [],
    async run() {
      const [rows, paths] = await Promise.all([
        db.asset.findMany({ where: { deletedAt: null, storesPhi: true, status: { not: "DISPOSED" } }, include: { type: { select: { name: true } } }, orderBy: { tag: "asc" } }),
        pathMap(),
      ]);
      return {
        columns: ["Tag", "Name", "Type", "Status", "Location", "Network segmented", "Risk class", "Last PM", "Next PM", "Hostname", "IP"],
        rows: rows.map((a) => [a.tag, a.name, a.type.name, a.status, a.locationId ? paths.get(a.locationId) : null, a.networkSegmented, a.riskClass, a.lastPmDate, a.nextPmDate, a.hostname, a.ipAddress]),
        summary: `${rows.length} devices · ${rows.filter((a) => !a.networkSegmented).length} not on a segmented network`,
      };
    },
  },
  {
    key: "pm-due",
    title: "Preventive maintenance due",
    description: "Medical devices with preventive maintenance due within the window (overdue included).",
    category: "Medical devices",
    module: "assets",
    params: [windowDays("days", "Due within", 30, [7, 14, 30, 60, 90])],
    async run(_, p) {
      const [rows, paths] = await Promise.all([
        db.asset.findMany({ where: { deletedAt: null, status: { notIn: ["DISPOSED", "RETIRED"] }, nextPmDate: { lte: until(Number(p.days)) } }, include: { type: { select: { name: true } } }, orderBy: { nextPmDate: "asc" } }),
        pathMap(),
      ]);
      const now = Date.now();
      return {
        columns: ["Tag", "Name", "Type", "Location", "Biomed owner", "Last PM", "Next PM", "Days", "Overdue"],
        rows: rows.map((a) => {
          const d = Math.ceil((a.nextPmDate!.getTime() - now) / DAY);
          return [a.tag, a.name, a.type.name, a.locationId ? paths.get(a.locationId) : null, a.biomedOwner, a.lastPmDate, a.nextPmDate, d, d < 0];
        }),
        summary: `${rows.filter((a) => a.nextPmDate!.getTime() < now).length} overdue of ${rows.length}`,
      };
    },
  },
  {
    key: "license-compliance",
    title: "Licence compliance",
    description: "Seats bought vs. assigned for every licence, with over-allocation and seats held by retired devices or leavers.",
    category: "Software & contracts",
    module: "software",
    params: [],
    async run() {
      const rows = await db.license.findMany({
        where: { deletedAt: null },
        include: {
          software: { select: { name: true } },
          vendor: { select: { name: true } },
          assignments: { select: { asset: { select: { status: true, deletedAt: true } }, person: { select: { active: true, deletedAt: true } } } },
        },
        orderBy: [{ software: { name: "asc" } }, { name: "asc" }],
      });
      const out = rows.map((l) => {
        const u = seatUsage(l.seatBasis === "SITE" ? null : l.seats, l.assignments.length);
        const stale = l.assignments.filter((a) => (a.asset && (a.asset.deletedAt || ["RETIRED", "DISPOSED", "LOST"].includes(a.asset.status))) || (a.person && (!a.person.active || a.person.deletedAt))).length;
        return [l.software.name, l.name, l.seatBasis, u.seats ?? "unlimited", u.used, u.free, u.over, stale, l.expiresAt, l.vendor?.name, l.poNumber] as Cell[];
      });
      return {
        columns: ["Software", "Licence", "Per", "Seats", "Used", "Free", "Over-allocated", "Reclaimable", "Expires", "Vendor", "PO"],
        rows: out,
        summary: `${out.filter((r) => Number(r[6]) > 0).length} over-allocated licence(s) · ${out.reduce((n, r) => n + Number(r[7]), 0)} reclaimable seat(s)`,
      };
    },
  },
  {
    key: "renewals",
    title: "Contract & licence renewals",
    description: "Notice deadlines, contract end dates and licence expiries coming up.",
    category: "Software & contracts",
    module: "vendors",
    params: [windowDays("days", "Due within", 90, [30, 60, 90, 180, 365])],
    async run(ctx, p) {
      const items = await renewals(ctx, Number(p.days));
      return {
        columns: ["Due", "Days", "What", "Item", "Type", "Vendor", "Status"],
        rows: items.map((r) => [r.due, r.daysLeft, r.what, r.title, r.kind === "license" ? "Licence" : "Contract", r.vendor, r.state]),
        summary: `${items.length} items`,
      };
    },
  },
  {
    key: "incidents",
    title: "Incidents by period",
    description: "Incidents started in the period with severity, time to mitigate and resolve, and cause.",
    category: "Operations",
    module: "changes",
    params: [windowDays("days", "In the last", 90, [7, 30, 90, 180, 365])],
    async run(_, p) {
      const rows = await db.incident.findMany({
        where: { startedAt: { gte: since(Number(p.days)) } },
        include: { owner: { select: { displayName: true } }, causedByChange: { select: { number: true } } },
        orderBy: { startedAt: "desc" },
      });
      const mins = (a: Date, b: Date | null) => (b ? Math.round((b.getTime() - a.getTime()) / 60_000) : null);
      const resolved = rows.filter((i) => i.resolvedAt);
      const mttr = resolved.length ? resolved.reduce((n, i) => n + (i.resolvedAt!.getTime() - i.startedAt.getTime()), 0) / resolved.length : null;
      return {
        columns: ["Incident", "Title", "Severity", "Status", "Started", "Minutes to mitigate", "Minutes to resolve", "Caused by change", "Owner", "Root cause"],
        rows: rows.map((i) => [incidentNo(i.number), i.title, i.severity, i.status, i.startedAt, mins(i.startedAt, i.mitigatedAt), mins(i.startedAt, i.resolvedAt), i.causedByChange ? changeNo(i.causedByChange.number) : null, i.owner?.displayName, i.rootCause]),
        summary: `${rows.length} incidents (${rows.filter((i) => i.severity === "P1" || i.severity === "P2").length} P1/P2)${mttr !== null ? ` · mean time to resolve ${duration(new Date(0), new Date(mttr))}` : ""}`,
      };
    },
  },
  {
    key: "changes",
    title: "Changes by period",
    description: "Changes planned or carried out in the period, with approval and outcome.",
    category: "Operations",
    module: "changes",
    params: [windowDays("days", "In the last", 90, [7, 30, 90, 180, 365])],
    async run(_, p) {
      const from = since(Number(p.days));
      const rows = await db.changeRequest.findMany({ where: { OR: [{ createdAt: { gte: from } }, { plannedStart: { gte: from } }, { actualEnd: { gte: from } }] }, orderBy: { number: "desc" } });
      const finished = rows.filter((c) => ["COMPLETED", "FAILED", "ROLLED_BACK"].includes(c.status));
      const ok = finished.filter((c) => c.status === "COMPLETED").length;
      return {
        columns: ["Change", "Title", "Type", "Risk", "Status", "Planned start", "Planned end", "Actual start", "Actual end", "Requested by", "Approved by", "Outcome"],
        rows: rows.map((c) => [changeNo(c.number), c.title, c.type, c.risk, c.status, c.plannedStart, c.plannedEnd, c.actualStart, c.actualEnd, c.requesterName, c.approverName, c.outcomeNote]),
        summary: `${rows.length} changes · ${finished.length ? Math.round((ok / finished.length) * 100) : 0}% of finished changes succeeded`,
      };
    },
  },
  {
    key: "kb-review",
    title: "Knowledge base reviews due",
    description: "Published articles whose review date has passed or falls within the window.",
    category: "Operations",
    module: "kb",
    params: [windowDays("days", "Due within", 30, [0, 7, 30, 90])],
    async run(_, p) {
      const rows = await db.article.findMany({
        where: { deletedAt: null, isTemplate: false, status: "PUBLISHED", reviewDueAt: { lte: until(Number(p.days)) } },
        include: { owner: { select: { displayName: true } }, category: { select: { name: true } } },
        orderBy: { reviewDueAt: "asc" },
      });
      return {
        columns: ["Article", "Category", "Owner", "Review due", "Last reviewed", "Version", "Updated"],
        rows: rows.map((a) => [a.title, a.category?.name, a.owner?.displayName, a.reviewDueAt, a.lastReviewedAt, a.version, a.updatedAt]),
        summary: `${rows.length} articles`,
      };
    },
  },
  {
    key: "vault-rotation",
    title: "Password rotation due",
    description: "Vault credentials (titles only) whose rotation is overdue or due within 14 days, from folders you can open.",
    category: "Security",
    module: "vault",
    params: [],
    async run(ctx) {
      const rows = await listCredentials(ctx, { due: true });
      return {
        columns: ["Title", "Folder", "Username", "Rotation due", "Password last changed"],
        rows: rows.map((c) => [c.title, c.folder.name, c.username, c.rotationDueAt, c.passwordChangedAt]),
        summary: `${rows.length} credentials`,
      };
    },
  },
  {
    key: "user-access",
    title: "User access review",
    description: "Every app account with its role, sign-in source, MFA and last sign-in — for periodic access reviews.",
    category: "Security",
    module: "audit", // admins and auditors
    params: [],
    async run() {
      const rows = await db.user.findMany({ orderBy: [{ active: "desc" }, { username: "asc" }] });
      return {
        columns: ["Username", "Name", "Role", "Source", "Active", "MFA", "Last sign-in", "Created"],
        rows: rows.map((u) => [u.username, u.displayName, u.role, u.source, u.active, u.source === "LOCAL" ? u.totpEnabled : null, u.lastLoginAt, u.createdAt]),
        summary: `${rows.filter((u) => u.active).length} active accounts · ${rows.filter((u) => u.active && u.source === "LOCAL" && !u.totpEnabled).length} local without MFA`,
      };
    },
  },
];

export function reportsFor(ctx: Ctx) {
  if (!can(ctx.user.role, "reports", "read")) return [];
  return REPORTS.filter((r) => can(ctx.user.role, r.module, "read"));
}

export function getReportDef(ctx: Ctx, key: string) {
  assertCan(ctx.user.role, "reports", "read");
  const r = REPORTS.find((x) => x.key === key);
  if (!r) throw new NotFoundError("Report");
  assertCan(ctx.user.role, r.module, "read");
  return r;
}

/** Only accept declared parameters with declared values; fall back to defaults. */
export function cleanParams(def: ReportDef, raw: Record<string, unknown>) {
  const out: Record<string, string | number> = {};
  for (const p of def.params) {
    const v = raw[p.name];
    if (p.type === "days") out[p.name] = p.options.includes(Number(v)) ? Number(v) : p.default;
    else out[p.name] = p.options.some((o) => o.value === v) ? String(v) : p.default;
  }
  return out;
}

export async function runReport(ctx: Ctx, key: string, raw: Record<string, unknown> = {}) {
  const def = getReportDef(ctx, key);
  const params = cleanParams(def, raw);
  const res = await def.run(ctx, params);
  if (res.rows.length > 100_000) throw new AppError("This report is too large to run in the browser. Narrow the period.");
  return { def, params, ...res };
}

/** Human-readable parameter summary, e.g. "Ending within: 90 days". */
export function describeParams(def: ReportDef, params: Record<string, string | number>) {
  return def.params
    .map((p) => `${p.label}: ${p.type === "days" ? `${params[p.name]} days` : (p.options.find((o) => o.value === params[p.name])?.label ?? params[p.name])}`)
    .join(" · ");
}
