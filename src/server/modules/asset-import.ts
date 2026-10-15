import "server-only";
import { ZodError } from "zod";
import { AssetStatus } from "@prisma/client";
import { db } from "../db";
import { assertCan } from "../rbac/permissions";
import { AppError, FieldError } from "../lib/errors";
import { audit } from "../audit/log";
import { assetInput, createAsset, updateAsset } from "./assets";
import { parseFieldDefs, validateCustomFields } from "../lib/custom-fields";
import { locationTree } from "./locations";
import type { Ctx } from "../context";

export type ImportRow = Record<string, string>;
export type ImportResult = {
  dryRun: boolean;
  created: number;
  updated: number;
  errors: { row: number; tag?: string; message: string }[];
};

const MAX_ROWS = 5000;
const STATUS_ALIASES: Record<string, AssetStatus> = {
  "in stock": "IN_STOCK", instock: "IN_STOCK", stock: "IN_STOCK", spare: "IN_STOCK",
  deployed: "DEPLOYED", "in use": "DEPLOYED", active: "DEPLOYED",
  "in repair": "IN_REPAIR", repair: "IN_REPAIR", broken: "IN_REPAIR",
  loaned: "LOANED", ordered: "ORDERED", retired: "RETIRED", lost: "LOST", missing: "LOST",
};

/**
 * Import assets from CSV rows (same columns as the export). Rows whose tag already exists update that asset.
 * Lookups: type by name; location by full path ("A › B › C"), code or unique name; assignee by email, employee ID or name.
 */
export async function importAssets(ctx: Ctx, rows: ImportRow[], dryRun: boolean): Promise<ImportResult> {
  assertCan(ctx.user.role, "assets", "write");
  if (rows.length > MAX_ROWS) throw new AppError(`Import at most ${MAX_ROWS} rows at a time.`);

  const [types, locs, people, depts] = await Promise.all([
    db.assetType.findMany({ where: { deletedAt: null } }),
    locationTree(),
    db.person.findMany({ where: { deletedAt: null }, select: { id: true, name: true, email: true, employeeId: true } }),
    db.department.findMany({ where: { deletedAt: null } }),
  ]);
  const lc = (s?: string) => (s ?? "").trim().toLowerCase();
  const typeBy = new Map(types.map((t) => [lc(t.name), t.id]));
  const locByPath = new Map(locs.map((l) => [lc(l.path).replace(/\s*[›>/]\s*/g, "›"), l.id]));
  const locByCode = new Map(locs.filter((l) => l.code).map((l) => [lc(l.code!), l.id]));
  const nameCount = new Map<string, number>();
  for (const l of locs) nameCount.set(lc(l.name), (nameCount.get(lc(l.name)) ?? 0) + 1);
  const locByName = new Map(locs.filter((l) => nameCount.get(lc(l.name)) === 1).map((l) => [lc(l.name), l.id]));
  const deptBy = new Map(depts.map((d) => [lc(d.name), d.id]));

  const findLocation = (v?: string) => {
    if (!v?.trim()) return undefined;
    const key = lc(v);
    const id = locByPath.get(key.replace(/\s*[›>/]\s*/g, "›")) ?? locByCode.get(key) ?? locByName.get(key);
    if (!id) throw new AppError(`Unknown or ambiguous location "${v}"`);
    return id;
  };
  const findPerson = (name?: string, email?: string) => {
    if (email?.trim()) {
      const p = people.find((x) => lc(x.email ?? "") === lc(email) || lc(x.employeeId ?? "") === lc(email));
      if (p) return p.id;
    }
    if (!name?.trim()) return undefined;
    const matches = people.filter((x) => lc(x.name) === lc(name) || lc(x.employeeId ?? "") === lc(name));
    if (matches.length !== 1) throw new AppError(`${matches.length ? "Ambiguous" : "Unknown"} assignee "${name}"`);
    return matches[0].id;
  };

  const result: ImportResult = { dryRun, created: 0, updated: 0, errors: [] };
  const seenTags = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = Object.fromEntries(Object.entries(rows[i]).map(([k, v]) => [k.trim(), typeof v === "string" ? v.trim() : v]));
    const rowNo = i + 2; // header is row 1
    try {
      if (r.tag) {
        if (seenTags.has(lc(r.tag))) throw new AppError(`Duplicate tag ${r.tag} in file`);
        seenTags.add(lc(r.tag));
      }
      const typeId = typeBy.get(lc(r.type));
      if (!typeId) throw new AppError(`Unknown asset type "${r.type ?? ""}" — create it in Admin › Asset types first`);
      const status = r.status ? (r.status.toUpperCase() in AssetStatus ? (r.status.toUpperCase() as AssetStatus) : STATUS_ALIASES[lc(r.status)]) : undefined;
      if (r.status && !status) throw new AppError(`Unknown status "${r.status}"`);
      if (status === "DISPOSED") throw new AppError("Use the disposal workflow for disposed assets");

      const customFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) if (k.startsWith("cf_") && v !== "") customFields[k.slice(3)] = v;
      const payload = {
        tag: r.tag || undefined,
        name: r.name || [r.manufacturer, r.model].filter(Boolean).join(" ") || r.serial || "",
        typeId,
        status,
        manufacturer: r.manufacturer, model: r.model, serial: r.serial, hostname: r.hostname,
        ipAddress: r.ipAddress, macAddress: r.macAddress, os: r.os,
        locationId: findLocation(r.location),
        assigneeId: findPerson(r.assignee, r.assigneeEmail),
        departmentId: r.department ? deptBy.get(lc(r.department)) ?? (() => { throw new AppError(`Unknown department "${r.department}"`); })() : undefined,
        vendorName: r.vendorName, poNumber: r.poNumber, purchaseDate: r.purchaseDate, purchaseCost: r.purchaseCost,
        warrantyEnd: r.warrantyEnd, eolDate: r.eolDate,
        storesPhi: ["yes", "true", "1", "y"].includes(lc(r.storesPhi)) ? "on" : undefined,
        udi: r.udi, riskClass: r.riskClass, lastPmDate: r.lastPmDate, nextPmDate: r.nextPmDate, notes: r.notes,
        changeReason: "CSV import",
        customFields,
      };
      for (const k of Object.keys(payload) as (keyof typeof payload)[]) if (payload[k] === "") delete payload[k];

      const existing = r.tag ? await db.asset.findFirst({ where: { tag: r.tag, deletedAt: null }, select: { id: true, status: true } }) : null;
      if (existing?.status === "DISPOSED") throw new AppError(`${r.tag} is disposed and read-only`);
      if (dryRun) {
        // Validate exactly as a real import would, without writing
        assetInput.parse(payload);
        const t = types.find((x) => x.id === typeId)!;
        const cf = validateCustomFields(parseFieldDefs(t.fieldDefs), customFields);
        if (Object.keys(cf.errors).length) throw new AppError(Object.values(cf.errors).join("; "));
        if (existing) result.updated++;
        else result.created++;
      } else if (existing) {
        // Merge: blank / missing cells keep the current value rather than clearing it
        const base = await currentInput(existing.id);
        const merged: Record<string, unknown> = { ...base };
        for (const [k, v] of Object.entries(payload)) if (v !== undefined && k !== "customFields") merged[k] = v;
        merged.customFields = { ...(base.customFields as object), ...customFields };
        await updateAsset(ctx, existing.id, merged);
        result.updated++;
      } else {
        await createAsset(ctx, payload, "IMPORT");
        result.created++;
      }
    } catch (e) {
      const message =
        e instanceof ZodError ? e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")
        : e instanceof FieldError ? Object.values(e.fieldErrors).join("; ")
        : e instanceof AppError ? e.message
        : (e as Error).message;
      result.errors.push({ row: rowNo, tag: r.tag, message });
      if (result.errors.length >= 200) break;
    }
  }
  if (!dryRun) {
    await audit(db, ctx, {
      action: "import",
      entityType: "Asset",
      summary: `CSV import: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`,
    });
  }
  return result;
}

/** Current asset values in the same shape as form input, for merge-updates. */
async function currentInput(id: string) {
  const a = await db.asset.findUniqueOrThrow({ where: { id } });
  const d = (x: Date | null) => x?.toISOString().slice(0, 10);
  const u = <T,>(x: T | null) => x ?? undefined;
  return {
    tag: a.tag, name: a.name, typeId: a.typeId, status: a.status,
    manufacturer: u(a.manufacturer), model: u(a.model), serial: u(a.serial), hostname: u(a.hostname),
    ipAddress: u(a.ipAddress), macAddress: u(a.macAddress), os: u(a.os),
    locationId: u(a.locationId), assigneeId: u(a.assigneeId), departmentId: u(a.departmentId),
    vendorName: u(a.vendorName), poNumber: u(a.poNumber), purchaseDate: d(a.purchaseDate),
    purchaseCost: a.purchaseCost?.toString(), warrantyEnd: d(a.warrantyEnd), eolDate: d(a.eolDate),
    udi: u(a.udi), riskClass: u(a.riskClass), biomedOwner: u(a.biomedOwner), pmIntervalDays: a.pmIntervalDays?.toString(),
    lastPmDate: d(a.lastPmDate), nextPmDate: d(a.nextPmDate),
    storesPhi: a.storesPhi ? "on" : undefined, networkSegmented: a.networkSegmented ? "on" : undefined,
    notes: u(a.notes), customFields: a.customFields as Record<string, unknown>,
  } as Record<string, unknown>;
}
