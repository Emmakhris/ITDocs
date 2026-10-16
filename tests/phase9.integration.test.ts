import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { authenticateToken, createToken, listTokens, revokeToken } from "@/server/modules/api-tokens";
import { runSync, parseSccmCsv, guidFromBuffer, externalRefsFor } from "@/server/modules/sync";
import { AppError, FieldError, ForbiddenError } from "@/server/lib/errors";
import * as assetsRoute from "@/app/api/v1/assets/route";
import * as assetRoute from "@/app/api/v1/assets/[id]/route";
import * as moveRoute from "@/app/api/v1/assets/[id]/move/route";
import * as meRoute from "@/app/api/v1/me/route";
import * as searchRoute from "@/app/api/v1/search/route";
import * as reportRoute from "@/app/api/v1/reports/[key]/route";
import { GET as openapi } from "@/app/api/v1/openapi.json/route";

const run = Date.now().toString(36);
const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `p9-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};

const BASE = "https://itdocs.test/api/v1";
function call<P>(handler: (req: Request, c: { params: Promise<P> }) => Promise<Response>, token: string | null, path: string, init: { method?: string; body?: unknown; params?: P } = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${BASE}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return handler(req, { params: Promise.resolve((init.params ?? {}) as P) });
}

let admin: Ctx, tech: Ctx, viewer: Ctx, typeId: string, locId: string;
beforeAll(async () => {
  [admin, tech, viewer] = await Promise.all([mkUser("ADMIN", "admin"), mkUser("TECHNICIAN", "tech"), mkUser("READONLY", "viewer")]);
  typeId = (await db.assetType.upsert({ where: { name: "API test type" }, create: { name: "API test type", tagPrefix: "API-" }, update: {} })).id;
  locId = (await db.location.create({ data: { name: `API room ${run}`, type: "ROOM" } })).id;
});

describe("API tokens", () => {
  it("stores only a hash, authenticates, and stops working once revoked or expired", async () => {
    const { token, row } = await createToken(tech, { name: "CMDB import", readOnly: "on", expiresInDays: "30" });
    expect(token).toMatch(/^itd_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(await db.apiToken.findUniqueOrThrow({ where: { id: row.id } }))).not.toContain(token);
    expect((await authenticateToken(`Bearer ${token}`, {}))?.ctx.user.id).toBe(tech.user.id);
    expect(await authenticateToken(`Bearer ${token}x`, {})).toBeNull();
    expect(await authenticateToken(token, {})).toBeNull(); // missing "Bearer"

    await revokeToken(viewer, row.id).then(() => expect.unreachable(), (e) => expect(e).toBeInstanceOf(ForbiddenError));
    await revokeToken(tech, row.id);
    expect(await authenticateToken(`Bearer ${token}`, {})).toBeNull();

    const exp = await createToken(tech, { name: "short", readOnly: "on", expiresInDays: "30" });
    await db.apiToken.update({ where: { id: exp.row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await authenticateToken(`Bearer ${exp.token}`, {})).toBeNull();
    expect(await db.auditLog.count({ where: { entityType: "ApiToken", entityId: row.id } })).toBe(2);
  });

  it("won't create write tokens for read-only roles, and admins can see everyone's tokens", async () => {
    await expect(createToken(viewer, { name: "x", expiresInDays: "30" })).rejects.toBeInstanceOf(FieldError);
    await createToken(viewer, { name: "viewer read", readOnly: "on", expiresInDays: "30" });
    expect((await listTokens(admin, true)).some((t) => t.name === "viewer read")).toBe(true);
    await expect(listTokens(tech, true)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("REST API v1", () => {
  let rw: string, ro: string, netOnly: string, viewerToken: string;
  beforeAll(async () => {
    rw = (await createToken(tech, { name: "rw", expiresInDays: "30" })).token;
    ro = (await createToken(tech, { name: "ro", readOnly: "on", expiresInDays: "30" })).token;
    netOnly = (await createToken(tech, { name: "net", scopes: ["network"], expiresInDays: "30" })).token;
    viewerToken = (await createToken(viewer, { name: "v", readOnly: "on", expiresInDays: "30" })).token;
  });

  it("rejects missing tokens with 401", async () => {
    const r = await call(assetsRoute.GET, null, "/assets");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("creates, reads, patches and moves an asset, recording movements and audit", async () => {
    const created = await call(assetsRoute.POST, rw, "/assets", { method: "POST", body: { name: `API laptop ${run}`, typeId, serial: `SN-${run}` } });
    expect(created.status).toBe(201);
    const a = await created.json();
    expect(a.tag).toMatch(/^API-\d{6}$/);

    const byTag = await (await call(assetRoute.GET, ro, `/assets/${a.tag}`, { params: { id: a.tag } })).json();
    expect(byTag.id).toBe(a.id);

    const patched = await call(assetRoute.PATCH, rw, `/assets/${a.id}`, { method: "PATCH", body: { hostname: "api-laptop-01", notes: "set via API" }, params: { id: a.id } });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ hostname: "api-laptop-01", serial: `SN-${run}`, name: `API laptop ${run}` }); // untouched fields kept

    const moved = await call(moveRoute.POST, rw, `/assets/${a.id}/move`, { method: "POST", body: { toLocationId: locId, toStatus: "DEPLOYED", reason: "Deployed by provisioning script" }, params: { id: a.id } });
    expect(moved.status).toBe(201);
    expect((await moved.json()).location.id).toBe(locId);
    expect(await db.assetMovement.count({ where: { assetId: a.id } })).toBe(2);
    const log = await db.auditLog.findFirst({ where: { entityType: "Asset", entityId: a.id, action: "update" } });
    expect(log?.userAgent).toMatch(/^api:itd_/);
  });

  it("enforces read-only tokens, scopes and the owner's role", async () => {
    expect((await call(assetsRoute.POST, ro, "/assets", { method: "POST", body: { name: "x", typeId } })).status).toBe(403);
    expect((await call(assetsRoute.GET, netOnly, "/assets")).status).toBe(403);
    expect((await call(assetsRoute.GET, viewerToken, "/assets")).status).toBe(200);
    const me = await (await call(meRoute.GET, netOnly, "/me")).json();
    expect(me.access).toMatchObject({ network: "write", assets: "none" });
  });

  it("validates input and returns field errors", async () => {
    const r = await call(assetsRoute.POST, rw, "/assets", { method: "POST", body: { typeId } });
    expect(r.status).toBe(422);
    expect((await r.json()).fieldErrors.name).toBeTruthy();
    const bad = await assetsRoute.POST(new Request(`${BASE}/assets`, { method: "POST", headers: { authorization: `Bearer ${rw}`, "content-type": "text/plain" }, body: "x" }), { params: Promise.resolve({}) });
    expect(bad.status).toBe(415);
  });

  it("never exposes vault data, and keeps search within scope", async () => {
    const folder = await db.vaultFolder.create({ data: { name: `API vault ${run}` } });
    await db.credential.create({ data: { id: `cred-${run}`, folderId: folder.id, title: `API secret ${run}`, secretEnc: "x", createdBy: "test" } });
    const hits = (await (await call(searchRoute.GET, rw, `/search?q=API`)).json()).data as { kind: string }[];
    expect(hits.some((h) => h.kind === "Credential")).toBe(false);
    expect((await call(reportRoute.GET, rw, "/reports/vault-rotation", { params: { key: "vault-rotation" } })).status).toBe(403);
    const inv = await call(reportRoute.GET, ro, "/reports/inventory", { params: { key: "inventory" } });
    expect((await inv.json()).columns[0]).toBe("Tag");
  }, 30_000); // the inventory report reads every asset, and the test DB may hold the 50k-asset perf seed

  it("publishes an OpenAPI description", async () => {
    const spec = await (await openapi()).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/assets/{id}/move");
  });
});

describe("sync", () => {
  it("parses ConfigMgr CSV exports with friendly or raw column names", () => {
    const rows = parseSccmCsv("﻿Netbios_Name0,SerialNumber0,Manufacturer0,Model0,Caption0,User_Name0,ResourceID\r\nPC-1,ABC,Dell,Latitude,Microsoft Windows 11 Enterprise,jdoe,16777220\r\n");
    expect(rows).toEqual([{ externalId: "16777220", hostname: "PC-1", serial: "ABC", manufacturer: "Dell", model: "Latitude", os: "Microsoft Windows 11 Enterprise", user: "jdoe", lastSeen: null, data: { user: "jdoe" } }]);
    expect(() => parseSccmCsv("foo,bar\n1,2")).toThrow(FieldError);
  });

  it("formats AD objectGUIDs", () => {
    const b = Buffer.from("8f5b2d4cbd1e49478cc9a1b2c3d4e5f6", "hex");
    expect(guidFromBuffer(b)).toBe("4c2d5b8f-1ebd-4749-8cc9-a1b2c3d4e5f6");
  });

  it("previews then applies an SCCM import: matches by serial, links, and creates when asked", async () => {
    const existing = await db.asset.create({ data: { tag: `SC-${run}`, name: "Ward PC", typeId, serial: `SER-${run}`, hostname: "old-name" } });
    const csv = `Name,SerialNumber,Model,OperatingSystem,ResourceID\nWARD-PC-${run},ser-${run},OptiPlex 7010,Windows 11,res-a-${run}\nNEW-PC-${run},NEW-${run},OptiPlex 7020,Windows 11,res-b-${run}\n`;

    const preview = await runSync(admin, "sccm", { csv, dryRun: true });
    expect(preview.stats).toMatchObject({ seen: 2, matched: 1, updated: 1, unmatched: 1, created: 0 });
    expect((await db.asset.findUniqueOrThrow({ where: { id: existing.id } })).hostname).toBe("old-name"); // nothing written

    await expect(runSync(admin, "sccm", { csv, createMissing: true })).rejects.toBeInstanceOf(FieldError); // needs a type
    await expect(runSync(tech, "sccm", { csv })).rejects.toBeInstanceOf(ForbiddenError);
    const applied = await runSync(admin, "sccm", { csv, createMissing: true, assetTypeId: typeId });
    expect(applied.stats).toMatchObject({ matched: 1, created: 1, errors: 0 });
    expect(await db.asset.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ hostname: `WARD-PC-${run}`, model: "OptiPlex 7010", os: "Windows 11" });
    expect((await externalRefsFor("Asset", existing.id)).map((r) => r.externalId)).toEqual([`res-a-${run}`]);
    expect(await db.asset.count({ where: { serial: `NEW-${run}` } })).toBe(1);

    // Second run: matched through the stored link even after the serial changes
    const again = await runSync(admin, "sccm", { csv: csv.replace(`ser-${run}`, `CHANGED-${run}`).replace(`WARD-PC-${run}`, `RENAMED-${run}`), dryRun: true });
    expect(again.details).toEqual(expect.arrayContaining([expect.objectContaining({ tag: `SC-${run}`, by: "link" })]));
  });

  it("reports an unconfigured source clearly", async () => {
    const saved = process.env.LDAP_ENABLED;
    process.env.LDAP_ENABLED = "false"; // Prisma loads .env, so switch the dev directory off for this test
    await expect(runSync(admin, "ad")).rejects.toBeInstanceOf(AppError).finally(() => (process.env.LDAP_ENABLED = saved));
    const last = await db.syncRun.findFirst({ where: { source: "ad" }, orderBy: { startedAt: "desc" } });
    expect([last?.status, last?.error]).toEqual(["FAILED", expect.stringMatching(/not configured/)]);
  });
});
