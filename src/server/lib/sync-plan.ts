/**
 * Pure planning for directory / device syncs: given what ITDocs has and what the source reports,
 * work out what to create, update and deactivate. No database access, so it's testable and the
 * same plan drives both the dry-run preview and the real run.
 */

// ───────────────────────────── People (Active Directory) ─────────────────────────────

export type PersonRecord = {
  externalId: string;
  name: string;
  email?: string | null;
  employeeId?: string | null;
  title?: string | null;
  phone?: string | null;
  department?: string | null;
  enabled: boolean;
};

export type ExistingPerson = {
  id: string;
  adGuid: string | null;
  name: string;
  email: string | null;
  employeeId: string | null;
  title: string | null;
  phone: string | null;
  department: string | null;
  active: boolean;
};

export type PersonChange = { id: string; name: string; externalId: string; changes: Record<string, { from: unknown; to: unknown }>; link?: boolean };

export type PeoplePlan = {
  create: PersonRecord[];
  update: PersonChange[];
  deactivate: { id: string; name: string; reason: string }[];
  reactivate: { id: string; name: string }[];
  unchanged: number;
  skippedDisabled: number;
  /** Set when the plan looks wrong (e.g. the source returned far fewer people than before) */
  guard?: string;
};

const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
const clean = (s?: string | null) => (s?.trim() ? s.trim() : null);

/** Deactivating more than this share of directory-synced people in one run needs force. */
export const MAX_DEACTIVATE_SHARE = 0.2;

export function planPeople(existing: ExistingPerson[], incoming: PersonRecord[]): PeoplePlan {
  const plan: PeoplePlan = { create: [], update: [], deactivate: [], reactivate: [], unchanged: 0, skippedDisabled: 0 };
  const byGuid = new Map(existing.filter((p) => p.adGuid).map((p) => [p.adGuid!.toLowerCase(), p]));
  const byEmp = new Map(existing.filter((p) => p.employeeId).map((p) => [norm(p.employeeId), p]));
  const byEmail = new Map(existing.filter((p) => p.email).map((p) => [norm(p.email), p]));
  const seen = new Set<string>();

  for (const r of incoming) {
    // Match on the directory's stable ID first; fall back to employee ID, then email, to link
    // people who were entered by hand before the sync was switched on.
    let p = byGuid.get(r.externalId.toLowerCase());
    let link = false;
    if (!p && r.employeeId) p = byEmp.get(norm(r.employeeId));
    if (!p && r.email) p = byEmail.get(norm(r.email));
    if (p && !p.adGuid) link = true;
    else if (p && p.adGuid && p.adGuid.toLowerCase() !== r.externalId.toLowerCase()) p = undefined; // belongs to another directory object

    if (!p) {
      if (r.enabled) plan.create.push(r);
      else plan.skippedDisabled++;
      continue;
    }
    seen.add(p.id);
    if (!r.enabled) {
      if (p.active) plan.deactivate.push({ id: p.id, name: p.name, reason: "disabled in the directory" });
      else plan.unchanged++;
      continue;
    }
    if (!p.active) plan.reactivate.push({ id: p.id, name: p.name });
    const changes: PersonChange["changes"] = {};
    const want = { name: clean(r.name), email: clean(r.email), employeeId: clean(r.employeeId), title: clean(r.title), phone: clean(r.phone), department: clean(r.department) };
    for (const [k, v] of Object.entries(want) as [keyof typeof want, string | null][]) {
      // The directory is the source of truth, but never blank out a value it simply doesn't have
      if (v !== null && v !== p[k]) changes[k] = { from: p[k], to: v };
    }
    if (Object.keys(changes).length || link) plan.update.push({ id: p.id, name: p.name, externalId: r.externalId, changes, link });
    else if (p.active) plan.unchanged++;
  }

  for (const p of existing) {
    if (p.adGuid && p.active && !seen.has(p.id)) plan.deactivate.push({ id: p.id, name: p.name, reason: "no longer in the directory" });
  }

  const synced = existing.filter((p) => p.adGuid && p.active).length;
  if (synced >= 10 && plan.deactivate.length > synced * MAX_DEACTIVATE_SHARE)
    plan.guard = `This run would deactivate ${plan.deactivate.length} of ${synced} directory people. Check the search base and filter, or run again with "force".`;
  if (synced > 0 && incoming.length === 0) plan.guard = "The directory returned nobody. Nothing will be deactivated.";
  return plan;
}

// ───────────────────────────── Devices (Intune, SCCM) ─────────────────────────────

export type DeviceRecord = {
  externalId: string;
  hostname?: string | null;
  serial?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  os?: string | null;
  lastSeen?: Date | null;
  user?: string | null;
  /** Extra values kept on the link (compliance, owner type, OS version…) */
  data?: Record<string, unknown>;
};

export type ExistingDevice = {
  id: string;
  tag: string;
  hostname: string | null;
  serial: string | null;
  manufacturer: string | null;
  model: string | null;
  os: string | null;
};

export type DeviceMatch = {
  assetId: string;
  tag: string;
  record: DeviceRecord;
  by: "link" | "serial" | "hostname";
  changes: Record<string, { from: unknown; to: unknown }>;
};

export type DevicePlan = { matched: DeviceMatch[]; create: DeviceRecord[]; unmatched: DeviceRecord[]; ambiguous: { record: DeviceRecord; tags: string[] }[] };

// BIOS placeholders that are not real serial numbers
const JUNK_SERIALS = /^(to be filled by o\.?e\.?m\.?|system serial number|default string|not specified|none|n\/a|0+|1234567890|chassis serial number|invalid)$/i;

export function normSerial(s?: string | null) {
  const raw = (s ?? "").trim();
  if (JUNK_SERIALS.test(raw)) return null;
  const v = raw.toUpperCase().replace(/\s+/g, "");
  return v.length >= 3 && !JUNK_SERIALS.test(v) ? v : null;
}

/** Short hostname, lower case: "PC-123.corp.local" → "pc-123". */
export function normHost(s?: string | null) {
  const v = (s ?? "").trim().toLowerCase().split(".")[0];
  return v || null;
}

/**
 * Matches source devices to assets: an existing link first, then serial number, then hostname.
 * MDM is authoritative for hostname and OS; manufacturer, model and serial are only filled in when
 * empty. Location and assignee are never changed (those belong to the movement log).
 */
export function planDevices(existing: ExistingDevice[], links: Map<string, string>, incoming: DeviceRecord[], createMissing: boolean): DevicePlan {
  const plan: DevicePlan = { matched: [], create: [], unmatched: [], ambiguous: [] };
  const byId = new Map(existing.map((a) => [a.id, a]));
  const bySerial = new Map<string, ExistingDevice[]>();
  const byHost = new Map<string, ExistingDevice[]>();
  for (const a of existing) {
    const s = normSerial(a.serial);
    if (s) bySerial.set(s, [...(bySerial.get(s) ?? []), a]);
    const h = normHost(a.hostname);
    if (h) byHost.set(h, [...(byHost.get(h) ?? []), a]);
  }
  const used = new Set<string>();

  for (const r of incoming) {
    let a: ExistingDevice | undefined;
    let by: DeviceMatch["by"] = "link";
    const linked = links.get(r.externalId);
    if (linked) a = byId.get(linked);
    if (!a) {
      const s = normSerial(r.serial);
      const candidates = s ? (bySerial.get(s) ?? []) : [];
      if (candidates.length > 1) {
        plan.ambiguous.push({ record: r, tags: candidates.map((c) => c.tag) });
        continue;
      }
      if (candidates.length === 1) [a, by] = [candidates[0], "serial"];
    }
    if (!a) {
      const h = normHost(r.hostname);
      const candidates = h ? (byHost.get(h) ?? []) : [];
      // A hostname match is only trusted when the serials don't contradict it
      const ok = candidates.filter((c) => !normSerial(c.serial) || !normSerial(r.serial) || normSerial(c.serial) === normSerial(r.serial));
      if (ok.length > 1) {
        plan.ambiguous.push({ record: r, tags: ok.map((c) => c.tag) });
        continue;
      }
      if (ok.length === 1) [a, by] = [ok[0], "hostname"];
    }
    if (!a || used.has(a.id)) {
      if (a) plan.ambiguous.push({ record: r, tags: [a.tag] });
      else (createMissing ? plan.create : plan.unmatched).push(r);
      continue;
    }
    used.add(a.id);
    const changes: DeviceMatch["changes"] = {};
    const set = (k: keyof ExistingDevice, v: string | null | undefined, overwrite: boolean) => {
      const val = v?.trim() || null;
      if (!val || val === a![k]) return;
      if (overwrite || !a![k]) changes[k] = { from: a![k], to: val };
    };
    set("hostname", r.hostname, true);
    set("os", r.os, true);
    if (!normSerial(a.serial)) set("serial", normSerial(r.serial), false);
    set("manufacturer", r.manufacturer, false);
    set("model", r.model, false);
    plan.matched.push({ assetId: a.id, tag: a.tag, record: r, by, changes });
  }
  return plan;
}
