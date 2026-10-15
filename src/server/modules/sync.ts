import "server-only";
import Papa from "papaparse";
import { Prisma, type SyncStatus } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError, FieldError } from "../lib/errors";
import { ldapBind, ldapClient } from "../auth/ldap";
import { planDevices, planPeople, type DevicePlan, type DeviceRecord, type PeoplePlan, type PersonRecord } from "../lib/sync-plan";
import { createAsset } from "./assets";
import type { Ctx } from "../context";

// Directory and device sync. Sources:
//   ad      — people from Active Directory / LDAP (paged search, read-only service account)
//   intune  — managed devices from Microsoft Graph (app registration, DeviceManagementManagedDevices.Read.All)
//   sccm    — devices from a ConfigMgr CSV export (upload, or drop into SCCM_IMPORT_DIR)
// Every run is recorded in SyncRun with its plan; dry runs only record the plan.

export type SyncSource = "ad" | "intune" | "sccm";
const env = (k: string, d = "") => process.env[k] || d;

export function sourceStatus() {
  return {
    ad: { configured: env("LDAP_ENABLED") === "true" && !!env("LDAP_URL"), detail: env("LDAP_URL") ? `${env("LDAP_URL")} · ${env("LDAP_SYNC_BASE_DN", env("LDAP_BASE_DN"))}` : "LDAP is not configured" },
    intune: { configured: !!(env("INTUNE_TENANT_ID") && env("INTUNE_CLIENT_ID") && env("INTUNE_CLIENT_SECRET")), detail: env("INTUNE_TENANT_ID") ? `Tenant ${env("INTUNE_TENANT_ID")}` : "Set INTUNE_TENANT_ID, INTUNE_CLIENT_ID and INTUNE_CLIENT_SECRET" },
    sccm: { configured: true, detail: env("SCCM_IMPORT_DIR") ? `CSV upload, or files in ${env("SCCM_IMPORT_DIR")}` : "CSV upload" },
  };
}

// ───────────────────────────── Fetchers ─────────────────────────────

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown) => {
  const x = first(v);
  return x === undefined || x === null ? null : Buffer.isBuffer(x) ? x.toString("utf8") : String(x);
};

/** AD objectGUID is little-endian binary; turn it into the usual GUID text form. */
export function guidFromBuffer(b: Buffer) {
  if (b.length !== 16) return b.toString("hex");
  const h = (i: number, n: number, rev: boolean) => {
    const s = b.subarray(i, i + n);
    return Buffer.from(rev ? [...s].reverse() : s).toString("hex");
  };
  return `${h(0, 4, true)}-${h(4, 2, true)}-${h(6, 2, true)}-${h(8, 2, false)}-${h(10, 6, false)}`;
}

async function fetchAdPeople(): Promise<PersonRecord[]> {
  if (!sourceStatus().ad.configured) throw new AppError("LDAP is not configured (LDAP_ENABLED, LDAP_URL).");
  const idAttr = env("LDAP_SYNC_ID_ATTR", "objectGUID");
  const a = {
    name: env("LDAP_DISPLAYNAME_ATTR", "displayName"),
    email: env("LDAP_EMAIL_ATTR", "mail"),
    emp: env("LDAP_SYNC_EMPLOYEEID_ATTR", "employeeID"),
    title: env("LDAP_SYNC_TITLE_ATTR", "title"),
    phone: env("LDAP_SYNC_PHONE_ATTR", "telephoneNumber"),
    dept: env("LDAP_SYNC_DEPARTMENT_ATTR", "department"),
  };
  const c = ldapClient();
  try {
    await ldapBind(c, env("LDAP_BIND_DN"), env("LDAP_BIND_PASSWORD"));
    const { searchEntries } = await c.search(env("LDAP_SYNC_BASE_DN", env("LDAP_BASE_DN")), {
      scope: "sub",
      // Default: AD user accounts (not computers, not contacts)
      filter: env("LDAP_SYNC_FILTER", "(&(objectCategory=person)(objectClass=user))"),
      attributes: [idAttr, a.name, "cn", a.email, a.emp, a.title, a.phone, a.dept, "userAccountControl"],
      explicitBufferAttributes: idAttr === "objectGUID" ? ["objectGUID"] : [],
      paged: { pageSize: 500 },
      sizeLimit: 0,
    });
    return searchEntries.flatMap((e) => {
      const raw = first(e[idAttr]);
      const externalId = Buffer.isBuffer(raw) ? guidFromBuffer(raw) : str(raw);
      if (!externalId) return [];
      const uac = Number(str(e.userAccountControl) ?? 0);
      return [
        {
          externalId,
          name: str(e[a.name]) || str(e.cn) || externalId,
          email: str(e[a.email]),
          employeeId: str(e[a.emp]),
          title: str(e[a.title]),
          phone: str(e[a.phone]),
          department: str(e[a.dept]),
          enabled: !(uac & 2), // ACCOUNTDISABLE
        },
      ];
    });
  } catch (e) {
    throw new AppError(`Directory search failed: ${(e as Error).message}`);
  } finally {
    await c.unbind().catch(() => {});
  }
}

async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(env("INTUNE_TENANT_ID"))}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("INTUNE_CLIENT_ID"), client_secret: env("INTUNE_CLIENT_SECRET"), scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!r.ok || !j.access_token) throw new AppError(`Microsoft sign-in failed: ${j.error_description?.split("\r\n")[0] ?? `HTTP ${r.status}`}`);
  return j.access_token;
}

type GraphDevice = {
  id: string;
  deviceName?: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  operatingSystem?: string;
  osVersion?: string;
  lastSyncDateTime?: string;
  userPrincipalName?: string;
  complianceState?: string;
  managedDeviceOwnerType?: string;
  enrolledDateTime?: string;
};

async function fetchIntuneDevices(): Promise<DeviceRecord[]> {
  if (!sourceStatus().intune.configured) throw new AppError("Intune is not configured (INTUNE_TENANT_ID, INTUNE_CLIENT_ID, INTUNE_CLIENT_SECRET).");
  const token = await graphToken();
  const select = "id,deviceName,serialNumber,manufacturer,model,operatingSystem,osVersion,lastSyncDateTime,userPrincipalName,complianceState,managedDeviceOwnerType,enrolledDateTime";
  let url: string | undefined = `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=${select}&$top=999`;
  const out: DeviceRecord[] = [];
  for (let pages = 0; url && pages < 100; pages++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) throw new AppError("Microsoft Graph is throttling requests. Try again in a few minutes.");
    const j = (await r.json().catch(() => ({}))) as { value?: GraphDevice[]; "@odata.nextLink"?: string; error?: { message?: string } };
    if (!r.ok) throw new AppError(`Microsoft Graph error: ${j.error?.message ?? `HTTP ${r.status}`}`);
    for (const d of j.value ?? [])
      out.push({
        externalId: d.id,
        hostname: d.deviceName,
        serial: d.serialNumber,
        manufacturer: d.manufacturer,
        model: d.model,
        os: [d.operatingSystem, d.osVersion].filter(Boolean).join(" ") || null,
        lastSeen: d.lastSyncDateTime ? new Date(d.lastSyncDateTime) : null,
        user: d.userPrincipalName || null,
        data: { complianceState: d.complianceState, ownerType: d.managedDeviceOwnerType, enrolled: d.enrolledDateTime, user: d.userPrincipalName },
      });
    url = j["@odata.nextLink"];
  }
  return out;
}

// Column names accepted from a ConfigMgr export: the friendly names and the raw v_GS_/v_R_ view names.
const SCCM_COLUMNS = {
  externalId: ["resourceid", "resource id", "machineid"],
  hostname: ["name", "netbios_name0", "computer name", "device name", "name0"],
  serial: ["serialnumber", "serial number", "serialnumber0", "serial"],
  manufacturer: ["manufacturer", "manufacturer0"],
  model: ["model", "model0"],
  os: ["operatingsystem", "operating system", "caption0", "os", "operating_system_name_and0"],
  user: ["lastlogonuser", "last logon user", "user_name0", "primary user", "username"],
  lastSeen: ["lasthardwarescan", "last hardware scan", "lasthwscan", "last activity", "lastactivetime"],
} as const;

export function parseSccmCsv(text: string): DeviceRecord[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const headers = res.meta.fields ?? [];
  const col = (k: keyof typeof SCCM_COLUMNS) => headers.find((h) => (SCCM_COLUMNS[k] as readonly string[]).includes(h));
  const cols = Object.fromEntries((Object.keys(SCCM_COLUMNS) as (keyof typeof SCCM_COLUMNS)[]).map((k) => [k, col(k)])) as Record<keyof typeof SCCM_COLUMNS, string | undefined>;
  if (!cols.hostname && !cols.serial) throw new FieldError({ file: "The CSV needs a Name (or Netbios_Name0) and/or SerialNumber column." });
  return res.data.flatMap((row) => {
    const v = (k: keyof typeof SCCM_COLUMNS) => (cols[k] ? row[cols[k]!]?.trim() || null : null);
    const host = v("hostname");
    const id = v("externalId") ?? host ?? v("serial");
    if (!id) return [];
    const seen = v("lastSeen");
    const d = seen ? new Date(seen) : null;
    return [{ externalId: String(id), hostname: host, serial: v("serial"), manufacturer: v("manufacturer"), model: v("model"), os: v("os"), user: v("user"), lastSeen: d && !Number.isNaN(d.getTime()) ? d : null, data: { user: v("user") } }];
  });
}

// ───────────────────────────── Runs ─────────────────────────────

export type SyncOptions = { dryRun?: boolean; force?: boolean; createMissing?: boolean; assetTypeId?: string; csv?: string };

const sample = <T>(xs: T[], n = 200) => xs.slice(0, n);

async function finishRun(id: string, status: SyncStatus, stats: Record<string, number>, details: unknown[], error?: string) {
  return db.syncRun.update({ where: { id }, data: { status, finishedAt: new Date(), stats, details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue, error: error ?? null } });
}

/** Runs a sync (or a dry run). Returns the SyncRun row with its stats and the planned / applied changes. */
export async function runSync(ctx: Ctx, source: SyncSource, opts: SyncOptions = {}) {
  assertCan(ctx.user.role, "admin", "write");
  if (opts.createMissing && !opts.assetTypeId && source !== "ad") throw new FieldError({ assetTypeId: "Choose the asset type for new devices" });
  const running = await db.syncRun.findFirst({ where: { source, status: "RUNNING", startedAt: { gt: new Date(Date.now() - 30 * 60_000) } } });
  if (running) throw new AppError("A sync from this source is already running.");
  const run = await db.syncRun.create({ data: { source, dryRun: !!opts.dryRun, triggeredBy: ctx.user.displayName } });
  try {
    if (source === "ad") return await syncPeople(ctx, run.id, await fetchAdPeople(), opts);
    const records = source === "intune" ? await fetchIntuneDevices() : parseSccmCsv(opts.csv ?? "");
    return await syncDevices(ctx, run.id, source, records, opts);
  } catch (e) {
    const msg = e instanceof FieldError ? Object.values(e.fieldErrors).join(" ") : (e as Error).message;
    await finishRun(run.id, "FAILED", {}, [], msg);
    await audit(db, ctx, { action: "sync", entityType: "SyncRun", entityId: run.id, summary: `${source.toUpperCase()} sync failed: ${msg}` });
    throw e;
  }
}

async function syncPeople(ctx: Ctx, runId: string, incoming: PersonRecord[], opts: SyncOptions) {
  const existing = await db.person.findMany({ where: { deletedAt: null }, include: { department: { select: { name: true } } } });
  const plan: PeoplePlan = planPeople(
    existing.map((p) => ({ id: p.id, adGuid: p.adGuid, name: p.name, email: p.email, employeeId: p.employeeId, title: p.title, phone: p.phone, department: p.department?.name ?? null, active: p.active })),
    incoming,
  );
  const stats = { seen: incoming.length, created: plan.create.length, updated: plan.update.length, deactivated: plan.deactivate.length, reactivated: plan.reactivate.length, unchanged: plan.unchanged, skippedDisabled: plan.skippedDisabled, errors: 0 };
  const details = [
    ...sample(plan.create).map((p) => ({ action: "create", name: p.name, email: p.email, department: p.department })),
    ...sample(plan.update).map((u) => ({ action: u.link ? "link" : "update", name: u.name, changes: u.changes })),
    ...sample(plan.deactivate).map((d) => ({ action: "deactivate", name: d.name, reason: d.reason })),
    ...sample(plan.reactivate).map((d) => ({ action: "reactivate", name: d.name })),
  ];
  const blocked = plan.guard && !opts.force;
  if (opts.dryRun || blocked) {
    const r = await finishRun(runId, blocked ? "FAILED" : "SUCCESS", stats, details, blocked ? plan.guard : undefined);
    if (blocked) await audit(db, ctx, { action: "sync", entityType: "SyncRun", entityId: runId, summary: `AD sync stopped: ${plan.guard}` });
    return r;
  }

  const depIds = new Map((await db.department.findMany({ where: { deletedAt: null } })).map((d) => [d.name.toLowerCase(), d.id]));
  const dept = async (name?: string | null) => {
    if (!name) return null;
    const key = name.toLowerCase();
    if (!depIds.has(key)) depIds.set(key, (await db.department.upsert({ where: { name }, create: { name }, update: {} })).id);
    return depIds.get(key)!;
  };
  let errors = 0;
  const one = async (f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      errors++;
      console.error("[sync] person", e);
    }
  };
  for (const r of plan.create)
    await one(async () => {
      const p = await db.person.create({ data: { name: r.name, email: r.email ?? null, employeeId: r.employeeId ?? null, title: r.title ?? null, phone: r.phone ?? null, departmentId: await dept(r.department), adGuid: r.externalId, active: true } });
      await audit(db, ctx, { action: "create", entityType: "Person", entityId: p.id, summary: `AD sync: added ${p.name}` });
    });
  for (const u of plan.update)
    await one(async () => {
      const data: Prisma.PersonUncheckedUpdateInput = u.link ? { adGuid: u.externalId } : {};
      for (const [k, c] of Object.entries(u.changes)) {
        if (k === "department") data.departmentId = await dept(c.to as string);
        else (data as Record<string, unknown>)[k] = c.to;
      }
      await db.person.update({ where: { id: u.id }, data });
      await audit(db, ctx, { action: "update", entityType: "Person", entityId: u.id, summary: `AD sync: ${u.link ? "linked and " : ""}updated ${u.name} (${Object.keys(u.changes).join(", ") || "directory link"})`, after: u.changes });
    });
  for (const d of plan.deactivate)
    await one(async () => {
      await db.person.update({ where: { id: d.id }, data: { active: false } });
      await audit(db, ctx, { action: "update", entityType: "Person", entityId: d.id, summary: `AD sync: deactivated ${d.name} (${d.reason})` });
    });
  for (const d of plan.reactivate)
    await one(async () => {
      await db.person.update({ where: { id: d.id }, data: { active: true } });
      await audit(db, ctx, { action: "update", entityType: "Person", entityId: d.id, summary: `AD sync: reactivated ${d.name}` });
    });
  stats.errors = errors;
  const r = await finishRun(runId, errors ? "PARTIAL" : "SUCCESS", stats, details);
  await audit(db, ctx, { action: "sync", entityType: "SyncRun", entityId: runId, summary: `AD sync: ${stats.created} added, ${stats.updated} updated, ${stats.deactivated} deactivated, ${stats.reactivated} reactivated${errors ? `, ${errors} errors` : ""}` });
  return r;
}

async function syncDevices(ctx: Ctx, runId: string, source: "intune" | "sccm", incoming: DeviceRecord[], opts: SyncOptions) {
  const [assets, refs] = await Promise.all([
    db.asset.findMany({ where: { deletedAt: null, status: { not: "DISPOSED" } }, select: { id: true, tag: true, hostname: true, serial: true, manufacturer: true, model: true, os: true } }),
    db.externalRef.findMany({ where: { source, entityType: "Asset" }, select: { externalId: true, entityId: true } }),
  ]);
  const plan: DevicePlan = planDevices(assets, new Map(refs.map((r) => [r.externalId, r.entityId])), incoming, !!opts.createMissing);
  const withChanges = plan.matched.filter((m) => Object.keys(m.changes).length);
  const stats = { seen: incoming.length, matched: plan.matched.length, updated: withChanges.length, created: plan.create.length, unmatched: plan.unmatched.length, ambiguous: plan.ambiguous.length, errors: 0 };
  const label = (r: DeviceRecord) => r.hostname ?? r.serial ?? r.externalId;
  const details = [
    ...sample(withChanges).map((m) => ({ action: "update", tag: m.tag, by: m.by, device: label(m.record), changes: m.changes })),
    ...sample(plan.create).map((r) => ({ action: "create", device: label(r), serial: r.serial, model: r.model })),
    ...sample(plan.unmatched).map((r) => ({ action: "unmatched", device: label(r), serial: r.serial, user: r.user })),
    ...sample(plan.ambiguous).map((a) => ({ action: "ambiguous", device: label(a.record), candidates: a.tags })),
  ];
  if (opts.dryRun) return finishRun(runId, "SUCCESS", stats, details);

  const SOURCE = source === "intune" ? "Intune" : "SCCM";
  let errors = 0;
  const link = (assetId: string, r: DeviceRecord) =>
    db.externalRef.upsert({
      where: { source_externalId: { source, externalId: r.externalId } },
      create: { source, externalId: r.externalId, entityType: "Asset", entityId: assetId, lastSeenAt: r.lastSeen ?? new Date(), data: (r.data ?? {}) as Prisma.InputJsonValue },
      update: { entityId: assetId, lastSeenAt: r.lastSeen ?? new Date(), data: (r.data ?? {}) as Prisma.InputJsonValue },
    });
  for (const m of plan.matched) {
    try {
      await db.$transaction(async (tx) => {
        if (Object.keys(m.changes).length) {
          await tx.asset.update({ where: { id: m.assetId }, data: Object.fromEntries(Object.entries(m.changes).map(([k, c]) => [k, c.to])) });
          await audit(tx, ctx, { action: "update", entityType: "Asset", entityId: m.assetId, summary: `${SOURCE} sync updated ${m.tag}: ${Object.keys(m.changes).join(", ")}`, before: Object.fromEntries(Object.entries(m.changes).map(([k, c]) => [k, c.from])), after: Object.fromEntries(Object.entries(m.changes).map(([k, c]) => [k, c.to])) });
        }
      });
      await link(m.assetId, m.record);
    } catch (e) {
      errors++;
      console.error("[sync] device", e);
    }
  }
  for (const r of plan.create) {
    try {
      const a = await createAsset(ctx, { name: r.hostname ?? r.model ?? "Device", typeId: opts.assetTypeId, status: "DEPLOYED", hostname: r.hostname ?? undefined, serial: r.serial ?? undefined, manufacturer: r.manufacturer ?? undefined, model: r.model ?? undefined, os: r.os ?? undefined, notes: `Created by ${SOURCE} sync` }, "IMPORT");
      await link(a.id, r);
    } catch (e) {
      errors++;
      console.error("[sync] create", e);
    }
  }
  stats.errors = errors;
  const r = await finishRun(runId, errors ? "PARTIAL" : "SUCCESS", stats, details);
  await audit(db, ctx, { action: "sync", entityType: "SyncRun", entityId: runId, summary: `${SOURCE} sync: ${stats.matched} matched, ${stats.updated} updated, ${stats.created} created, ${stats.unmatched} not in ITDocs${errors ? `, ${errors} errors` : ""}` });
  return r;
}

export async function recentRuns(ctx: Ctx, take = 20) {
  assertCan(ctx.user.role, "admin", "read");
  return db.syncRun.findMany({ orderBy: { startedAt: "desc" }, take });
}

export async function getRun(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "admin", "read");
  return db.syncRun.findUnique({ where: { id } });
}

/** External identities for an asset or person page (source, last seen, reported values). */
export async function externalRefsFor(entityType: "Asset" | "Person", entityId: string) {
  return db.externalRef.findMany({ where: { entityType, entityId }, orderBy: { source: "asc" } });
}

/** Scheduled syncs (SYNC_AUTO=ad,intune): at most once a day per source, after the digest hour. */
export async function runAutoSyncs(ctx: Ctx, now = new Date()) {
  const wanted = env("SYNC_AUTO").split(",").map((s) => s.trim()).filter((s): s is "ad" | "intune" => s === "ad" || s === "intune");
  const done: string[] = [];
  for (const s of wanted) {
    if (!sourceStatus()[s].configured) continue;
    const last = await db.syncRun.findFirst({ where: { source: s, dryRun: false }, orderBy: { startedAt: "desc" } });
    if (last && now.getTime() - last.startedAt.getTime() < 23 * 3600_000) continue;
    await runSync(ctx, s).then(() => done.push(s)).catch((e) => console.error(`[sync] auto ${s} failed:`, (e as Error).message));
  }
  return done;
}
