import "server-only";
import { z } from "zod";
import nodemailer, { type Transporter } from "nodemailer";
import { AlertChannel, Prisma, ReportFormat, ReportFrequency, type DeliveryStatus } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { csvRow } from "../lib/csv";
import { buildXlsx } from "../lib/xlsx";
import { changeNo, incidentNo } from "../lib/workflow";
import { escapeHtml } from "@/lib/markdown";
import { getSettings, updateSettings } from "./settings";
import { REPORTS, describeParams, getReportDef, runReport } from "./reports";
import { renewals } from "./vendors";
import type { Ctx } from "../context";

// Outbound alerts: SMTP email and Microsoft Teams (incoming webhook / Workflows). Every attempt is
// logged in AlertDelivery; a dedupe key makes each alert go out at most once per channel even if
// the scheduler runs on several instances. Configuration: SMTP_* and TEAMS_WEBHOOK_URL in .env,
// recipients and timing in Admin › Alerts.

/** The scheduler acts as a system admin; audit entries show "ITDocs scheduler". */
export const SYSTEM_CTX: Ctx = { user: { id: "", username: "system", displayName: "ITDocs scheduler", role: "ADMIN" } };

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const link = (path: string) => `${appUrl()}${path}`;

// ───────────────────────────── Channels ─────────────────────────────

let transport: Transporter | null | undefined;
function mailer(): Transporter | null {
  if (transport !== undefined) return transport;
  const host = process.env.SMTP_HOST;
  if (!host) return (transport = null);
  // SMTP_HOST=log writes messages to the delivery log only — for testing without a mail server
  if (host === "log") return (transport = nodemailer.createTransport({ jsonTransport: true }));
  const port = Number(process.env.SMTP_PORT || 587);
  return (transport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    requireTLS: process.env.SMTP_REQUIRE_TLS !== "false" && port !== 25,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" } : undefined,
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false" },
  }));
}

export const emailConfigured = () => !!process.env.SMTP_HOST;
export const teamsConfigured = () => /^https:\/\/\S+$/.test(process.env.TEAMS_WEBHOOK_URL ?? "");

export function parseRecipients(raw: string | string[] | undefined): string[] {
  const list = (Array.isArray(raw) ? raw : (raw ?? "").split(/[,;\s]+/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((e) => !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e));
  if (bad.length) throw new FieldError({ recipients: `Not valid email address(es): ${bad.join(", ")}` });
  return [...new Set(list)].slice(0, 50);
}

type Message = {
  kind: string;
  subject: string;
  text: string;
  html: string;
  /** Short Teams version: headline facts and one link */
  teams?: { facts: [string, string][]; url: string; urgent?: boolean };
  attachments?: { filename: string; content: Buffer; contentType: string }[];
};

async function logDelivery(channel: AlertChannel, m: Message, recipients: string | null, status: DeliveryStatus, error: string | null, dedupeKey?: string) {
  const data = { channel, kind: m.kind, subject: m.subject.slice(0, 300), recipients, status, error: error?.slice(0, 1000) ?? null, dedupeKey: dedupeKey ?? null };
  return db.alertDelivery.create({ data });
}

/** Claims the dedupe key for a channel. False means it was already sent (or is being sent). */
async function claim(channel: AlertChannel, m: Message, dedupeKey: string) {
  try {
    return await logDelivery(channel, m, null, "SKIPPED", "sending…", dedupeKey);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

async function sendEmail(m: Message, to: string[], dedupeKey?: string) {
  const row = dedupeKey ? await claim("EMAIL", m, dedupeKey) : null;
  if (dedupeKey && !row) return "duplicate" as const;
  const finish = (status: DeliveryStatus, error: string | null) =>
    row ? db.alertDelivery.update({ where: { id: row.id }, data: { status, error, recipients: to.join(", ") || null } }) : logDelivery("EMAIL", m, to.join(", ") || null, status, error);
  const t = mailer();
  if (!t) return (await finish("SKIPPED", "Email is not configured (SMTP_HOST)"), "skipped" as const);
  if (!to.length) return (await finish("SKIPPED", "No recipients"), "skipped" as const);
  try {
    await t.sendMail({ from: process.env.SMTP_FROM || `ITDocs <itdocs@${new URL(appUrl()).hostname}>`, to, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
    await finish("SENT", null);
    return "sent" as const;
  } catch (e) {
    await finish("FAILED", (e as Error).message);
    return "failed" as const;
  }
}

/** Adaptive Card payload, accepted by Teams Workflows ("post to a channel when a webhook request is received") and legacy connectors. */
function teamsPayload(m: Message) {
  const t = m.teams!;
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: m.subject, weight: "Bolder", size: "Medium", wrap: true, color: t.urgent ? "Attention" : "Default" },
            { type: "FactSet", facts: t.facts.map(([title, value]) => ({ title, value })) },
          ],
          actions: [{ type: "Action.OpenUrl", title: "Open in ITDocs", url: t.url }],
        },
      },
    ],
  };
}

async function sendTeams(m: Message, dedupeKey?: string) {
  if (!m.teams) return "skipped" as const;
  const row = dedupeKey ? await claim("TEAMS", m, dedupeKey) : null;
  if (dedupeKey && !row) return "duplicate" as const;
  const finish = (status: DeliveryStatus, error: string | null) =>
    row ? db.alertDelivery.update({ where: { id: row.id }, data: { status, error, recipients: "Teams channel" } }) : logDelivery("TEAMS", m, "Teams channel", status, error);
  if (!teamsConfigured()) return (await finish("SKIPPED", "Teams is not configured (TEAMS_WEBHOOK_URL)"), "skipped" as const);
  try {
    const r = await fetch(process.env.TEAMS_WEBHOOK_URL!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(teamsPayload(m)), signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(`Teams returned HTTP ${r.status}`);
    await finish("SENT", null);
    return "sent" as const;
  } catch (e) {
    await finish("FAILED", (e as Error).message);
    return "failed" as const;
  }
}

// ───────────────────────────── Message building ─────────────────────────────

type Section = { title: string; items: { text: string; href: string }[]; more?: number };

function render(subject: string, intro: string, sections: Section[]) {
  const nonEmpty = sections.filter((s) => s.items.length);
  const text = [intro, "", ...nonEmpty.flatMap((s) => [`${s.title}:`, ...s.items.map((i) => `  - ${i.text}  ${link(i.href)}`), ...(s.more ? [`  … and ${s.more} more`] : []), ""])].join("\n");
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111827">
<p style="margin:0 0 12px">${escapeHtml(intro)}</p>
${nonEmpty
  .map(
    (s) => `<h3 style="font-size:15px;margin:16px 0 6px">${escapeHtml(s.title)}</h3><ul style="margin:0;padding-left:18px">${s.items
      .map((i) => `<li style="margin:2px 0"><a href="${escapeHtml(link(i.href))}" style="color:#0e6ba8">${escapeHtml(i.text)}</a></li>`)
      .join("")}${s.more ? `<li style="color:#5b6474">… and ${s.more} more</li>` : ""}</ul>`,
  )
  .join("\n")}
<p style="margin:20px 0 0;color:#5b6474;font-size:12px">Sent by ITDocs · <a href="${escapeHtml(link("/admin/alerts"))}" style="color:#5b6474">alert settings</a></p></div>`;
  return { subject, text, html };
}

const DAY = 86_400_000;
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const cap = <T>(rows: T[], n = 15) => ({ shown: rows.slice(0, n), more: Math.max(0, rows.length - n) });

/** Everything that needs someone's attention today. Vault items are counted, never named. */
export async function buildDigest(now = new Date()): Promise<{ sections: Section[]; total: number }> {
  const settings = await getSettings();
  const in30 = new Date(now.getTime() + 30 * DAY);
  const in14 = new Date(now.getTime() + 14 * DAY);
  const live = { deletedAt: null, status: { notIn: ["DISPOSED" as const, "RETIRED" as const] } };
  const [incidents, awaiting, windows, overdue, warranty, pm, due, overAlloc, kb, vaultDue] = await Promise.all([
    db.incident.findMany({ where: { status: { in: ["OPEN", "INVESTIGATING", "MITIGATED"] } }, orderBy: [{ severity: "asc" }, { startedAt: "asc" }] }),
    db.changeRequest.findMany({ where: { status: "SUBMITTED" }, orderBy: { plannedStart: "asc" } }),
    db.changeRequest.findMany({ where: { status: { in: ["APPROVED", "SUBMITTED"] }, plannedStart: { gte: now, lte: new Date(now.getTime() + DAY) } }, orderBy: { plannedStart: "asc" } }),
    db.checkout.findMany({ where: { returnedAt: null, dueAt: { lt: now } }, include: { asset: { select: { id: true, tag: true } }, person: { select: { name: true } } }, orderBy: { dueAt: "asc" } }),
    db.asset.findMany({ where: { ...live, warrantyEnd: { gte: now, lte: in30 } }, select: { id: true, tag: true, name: true, warrantyEnd: true }, orderBy: { warrantyEnd: "asc" } }),
    settings.medicalModule ? db.asset.findMany({ where: { ...live, nextPmDate: { lte: in14 } }, select: { id: true, tag: true, name: true, nextPmDate: true }, orderBy: { nextPmDate: "asc" } }) : [],
    renewals(SYSTEM_CTX, 30),
    db.license.findMany({ where: { deletedAt: null, seatBasis: { not: "SITE" }, seats: { not: null } }, select: { id: true, name: true, seats: true, software: { select: { name: true } }, _count: { select: { assignments: true } } } }),
    db.article.findMany({ where: { deletedAt: null, isTemplate: false, status: "PUBLISHED", reviewDueAt: { lte: now } }, select: { id: true, title: true } }),
    db.credential.count({ where: { deletedAt: null, rotationDueAt: { lte: now } } }),
  ]);
  const over = overAlloc.filter((l) => l._count.assignments > (l.seats ?? Infinity));
  const sec = <T>(title: string, rows: T[], map: (r: T) => { text: string; href: string }): Section => {
    const c = cap(rows);
    return { title, items: c.shown.map(map), more: c.more };
  };
  const sections: Section[] = [
    sec("Open incidents", incidents, (i) => ({ text: `${i.severity} ${incidentNo(i.number)} ${i.title} (${i.status.toLowerCase()})`, href: `/changes/incidents/${i.id}` })),
    sec("Changes awaiting approval", awaiting, (c) => ({ text: `${changeNo(c.number)} ${c.title}${c.plannedStart ? ` — window ${fmt(c.plannedStart)}` : ""}`, href: `/changes/${c.id}` })),
    sec("Change windows in the next 24 hours", windows, (c) => ({ text: `${changeNo(c.number)} ${c.title} — ${c.plannedStart!.toISOString().slice(11, 16)} UTC${c.status !== "APPROVED" ? " (not approved)" : ""}`, href: `/changes/${c.id}` })),
    sec("Overdue check-outs", overdue, (c) => ({ text: `${c.asset.tag} with ${c.person.name}, due ${fmt(c.dueAt!)}`, href: `/assets/${c.asset.id}` })),
    sec("Contract and licence deadlines (30 days)", due, (r) => ({ text: `${fmt(r.due)} — ${r.what}: ${r.title}${r.vendor ? ` (${r.vendor})` : ""}`, href: r.href })),
    sec("Over-allocated licences", over, (l) => ({ text: `${l.software.name} — ${l.name}: ${l._count.assignments} used of ${l.seats}`, href: `/software/licenses/${l.id}` })),
    sec("Warranties ending (30 days)", warranty, (a) => ({ text: `${a.tag} ${a.name} — ${fmt(a.warrantyEnd!)}`, href: `/assets/${a.id}` })),
    sec("Preventive maintenance due (14 days)", pm, (a) => ({ text: `${a.tag} ${a.name} — ${fmt(a.nextPmDate!)}`, href: `/assets/${a.id}` })),
    sec("Knowledge-base articles due for review", kb, (a) => ({ text: a.title, href: `/kb/${a.id}` })),
    { title: "Password vault", items: vaultDue ? [{ text: `${vaultDue} credential(s) overdue for rotation`, href: "/vault?due=1" }] : [] },
  ];
  return { sections, total: sections.reduce((n, s) => n + s.items.length + (s.more ?? 0), 0) };
}

// ───────────────────────────── Alerts ─────────────────────────────

/** Sends the daily digest once per day (per channel), if enabled and anything needs attention. */
export async function sendDigest(now = new Date(), opts: { force?: boolean } = {}) {
  const settings = await getSettings();
  if (!settings.digestEnabled && !opts.force) return { status: "disabled" as const };
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const { sections, total } = await buildDigest(now);
  const counts = sections.filter((s) => s.items.length).map((s): [string, string] => [s.title, String(s.items.length + (s.more ?? 0))]);
  const m: Message = {
    kind: "digest",
    ...render(`ITDocs daily digest — ${day}${total ? ` (${total} item${total === 1 ? "" : "s"})` : ""}`, total ? `Good morning. ${total} item(s) need attention in ${settings.orgName}'s IT records.` : "Nothing needs attention today.", sections),
    teams: { facts: counts.length ? counts : [["Status", "Nothing needs attention"]], url: link("/dashboard") },
  };
  if (!total && !opts.force) {
    await claim("EMAIL", { ...m, subject: `Daily digest ${day}: nothing to report` }, `digest:${day}`);
    return { status: "empty" as const };
  }
  // A forced (manual) run is not deduplicated, so admins can preview it any time
  const key = opts.force ? undefined : `digest:${day}`;
  const [email, teams] = await Promise.all([sendEmail(m, parseRecipients(settings.alertRecipients), key), sendTeams(m, key)]);
  return { status: "done" as const, email, teams, total };
}

/** Immediate alert for P1/P2 incidents (opened, or escalated to P1/P2). Never throws. */
export async function notifyIncident(incidentId: string, event: "opened" | "escalated") {
  try {
    const settings = await getSettings();
    if (!settings.incidentAlerts) return;
    const i = await db.incident.findUnique({ where: { id: incidentId }, include: { owner: { select: { displayName: true } } } });
    if (!i || (i.severity !== "P1" && i.severity !== "P2")) return;
    const no = incidentNo(i.number);
    const href = `/changes/incidents/${i.id}`;
    const m: Message = {
      kind: "incident",
      ...render(`[${i.severity}] ${no} ${event === "opened" ? "opened" : "escalated"}: ${i.title}`, `${i.severity} incident ${event === "opened" ? "opened" : "escalated"} by ${i.createdBy}.`, [
        { title: "Incident", items: [{ text: `${no} ${i.title}${i.impact ? ` — ${i.impact}` : ""}`, href }] },
      ]),
      teams: { facts: [["Severity", i.severity], ["Status", i.status.toLowerCase()], ["Owner", i.owner?.displayName ?? "—"], ["Impact", i.impact ?? "—"]], url: link(href), urgent: true },
    };
    const key = `incident:${i.id}:${i.severity}`;
    await Promise.all([sendEmail(m, parseRecipients(settings.alertRecipients), key), sendTeams(m, key)]);
  } catch (e) {
    console.error("Incident alert failed", e);
  }
}

export async function sendTest(ctx: Ctx, channel: "email" | "teams") {
  assertCan(ctx.user.role, "admin", "write");
  const settings = await getSettings();
  const m: Message = {
    kind: "test",
    ...render("ITDocs test message", `Test sent by ${ctx.user.displayName}. If you can read this, ${channel === "email" ? "email" : "Teams"} alerts work.`, []),
    teams: { facts: [["Sent by", ctx.user.displayName]], url: link("/admin/alerts") },
  };
  const r = channel === "email" ? await sendEmail(m, parseRecipients(settings.alertRecipients)) : await sendTeams(m);
  await audit(db, ctx, { action: "alert_test", entityType: "Settings", summary: `Sent a ${channel} test message (${r})` });
  return r;
}

// ───────────────────────────── Report subscriptions ─────────────────────────────

export const subscriptionInput = z.object({
  reportKey: z.string().min(1),
  frequency: z.nativeEnum(ReportFrequency).default("WEEKLY"),
  format: z.nativeEnum(ReportFormat).default("XLSX"),
  recipients: z.string().max(2000).default(""),
  params: z.record(z.string(), z.unknown()).default({}),
});

/** Next send time: the configured digest hour, one day / week / month on. */
export function nextRun(freq: ReportFrequency, from: Date, hour: number) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, 0, 0);
  if (freq === "DAILY") d.setDate(d.getDate() + 1);
  else if (freq === "WEEKLY") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export async function listSubscriptions(ctx: Ctx, reportKey?: string) {
  assertCan(ctx.user.role, "reports", "read");
  return db.reportSubscription.findMany({ where: reportKey ? { reportKey } : {}, orderBy: { createdAt: "desc" } });
}

export async function createSubscription(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "reports", "write");
  const d = subscriptionInput.parse(input);
  const def = getReportDef(ctx, d.reportKey);
  const recipients = parseRecipients(d.recipients);
  if (!recipients.length) throw new FieldError({ recipients: "Add at least one email address" });
  const settings = await getSettings();
  // Store only declared parameters
  const params = Object.fromEntries(def.params.map((p) => [p.name, d.params[p.name] ?? p.default]));
  return db.$transaction(async (tx) => {
    const s = await tx.reportSubscription.create({ data: { reportKey: def.key, frequency: d.frequency, format: d.format, recipients, params: params as Prisma.InputJsonValue, createdBy: ctx.user.displayName, nextRunAt: nextRun(d.frequency, new Date(), settings.digestHour) } });
    await audit(tx, ctx, { action: "create", entityType: "ReportSubscription", entityId: s.id, summary: `Scheduled "${def.title}" ${d.frequency.toLowerCase()} to ${recipients.join(", ")}` });
    return s;
  });
}

export async function deleteSubscription(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "reports", "write");
  await db.$transaction(async (tx) => {
    const s = await tx.reportSubscription.findUnique({ where: { id } });
    if (!s) throw new NotFoundError("Schedule");
    await tx.reportSubscription.delete({ where: { id } });
    await audit(tx, ctx, { action: "delete", entityType: "ReportSubscription", entityId: id, summary: `Removed scheduled report ${s.reportKey}` });
  });
}

/** Runs one subscription now (as the scheduler) and emails the file. */
async function deliverSubscription(s: { id: string; reportKey: string; params: Prisma.JsonValue; format: ReportFormat; recipients: string[] }, now: Date) {
  const res = await runReport(SYSTEM_CTX, s.reportKey, (s.params ?? {}) as Record<string, unknown>);
  const stamp = now.toISOString().slice(0, 10);
  const base = `${res.def.key}-${stamp}`;
  const content =
    s.format === "XLSX"
      ? Buffer.from(buildXlsx(res.def.title, res.columns, res.rows))
      : Buffer.from("﻿" + csvRow(res.columns) + res.rows.map((r) => csvRow(r)).join(""), "utf8");
  const m: Message = {
    kind: "report",
    ...render(`ITDocs report: ${res.def.title} (${stamp})`, `${res.def.title}${res.def.params.length ? ` — ${describeParams(res.def, res.params)}` : ""}. ${res.summary ?? `${res.rows.length} rows`}. The full report is attached.`, [
      { title: "Open in ITDocs", items: [{ text: res.def.title, href: `/reports/${res.def.key}` }] },
    ]),
    attachments: [{ filename: `${base}.${s.format === "XLSX" ? "xlsx" : "csv"}`, content, contentType: s.format === "XLSX" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv" }],
  };
  return sendEmail(m, s.recipients, `report:${s.id}:${stamp}`);
}

export async function runSubscriptionNow(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "reports", "write");
  const s = await db.reportSubscription.findUnique({ where: { id } });
  if (!s) throw new NotFoundError("Schedule");
  getReportDef(ctx, s.reportKey); // the person must be able to see this report
  const r = await deliverSubscription({ ...s, id: `${s.id}:manual:${Date.now()}` }, new Date());
  await audit(db, ctx, { action: "report_send", entityType: "ReportSubscription", entityId: id, summary: `Sent "${s.reportKey}" now (${r})` });
  return r;
}

// ───────────────────────────── Scheduler ─────────────────────────────

/**
 * Called every few minutes by src/instrumentation.ts (and by Admin › Alerts › Run now).
 * Safe to run on several instances at once: digests are deduplicated per day, and each due
 * subscription is claimed with a compare-and-set on nextRunAt before it is sent.
 */
export async function runScheduled(now = new Date()) {
  const settings = await getSettings();
  const out: { digest?: string; reports: number } = { reports: 0 };
  if (settings.digestEnabled && now.getHours() >= settings.digestHour) out.digest = (await sendDigest(now)).status;
  const due = await db.reportSubscription.findMany({ where: { active: true, nextRunAt: { lte: now } }, take: 20 });
  for (const s of due) {
    const next = nextRun(s.frequency, now, settings.digestHour);
    const claimed = await db.reportSubscription.updateMany({ where: { id: s.id, nextRunAt: s.nextRunAt }, data: { nextRunAt: next, lastSentAt: now } });
    if (!claimed.count) continue;
    try {
      await deliverSubscription(s, now);
      out.reports++;
    } catch (e) {
      await logDelivery("EMAIL", { kind: "report", subject: `Report ${s.reportKey} failed`, text: "", html: "" }, s.recipients.join(", "), "FAILED", (e as Error).message);
    }
  }
  return out;
}

// ───────────────────────────── Admin ─────────────────────────────

export const alertSettingsInput = z.object({
  alertRecipients: z.string().max(2000).default(""),
  digestEnabled: z.union([z.string(), z.boolean()]).optional().transform((v) => v === true || v === "on"),
  digestHour: z.coerce.number().int().min(0).max(23).default(7),
  incidentAlerts: z.union([z.string(), z.boolean()]).optional().transform((v) => v === true || v === "on"),
});

export async function saveAlertSettings(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "admin", "write");
  const d = alertSettingsInput.parse(input);
  const recipients = parseRecipients(d.alertRecipients);
  if (d.digestEnabled && !recipients.length && !teamsConfigured()) throw new FieldError({ alertRecipients: "Add at least one address (or configure Teams) to turn on the digest" });
  await updateSettings(ctx, { alertRecipients: recipients.join(", "), digestEnabled: d.digestEnabled, digestHour: d.digestHour, incidentAlerts: d.incidentAlerts });
}

export async function recentDeliveries(ctx: Ctx, take = 50) {
  assertCan(ctx.user.role, "admin", "read");
  return db.alertDelivery.findMany({ orderBy: { at: "desc" }, take });
}

export async function runNow(ctx: Ctx, what: "digest" | "scheduled") {
  assertCan(ctx.user.role, "admin", "write");
  const r = what === "digest" ? await sendDigest(new Date(), { force: true }) : await runScheduled();
  await audit(db, ctx, { action: "alert_run", entityType: "Settings", summary: `Ran ${what === "digest" ? "the daily digest" : "scheduled jobs"} manually` });
  if ("status" in r && r.status === "disabled") throw new AppError("The digest is turned off.");
  return r;
}

export const reportTitle = (key: string) => REPORTS.find((r) => r.key === key)?.title ?? key;
