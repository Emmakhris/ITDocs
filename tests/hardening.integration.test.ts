import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { LIMITS, hit, peek, reset } from "@/server/lib/rate-limit";
import { createToken } from "@/server/modules/api-tokens";
import { createCredential, reveal, saveFolder } from "@/server/modules/vault";
import { AppError } from "@/server/lib/errors";
import * as meRoute from "@/app/api/v1/me/route";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

const run = Date.now().toString(36);

describe("rate limiter", () => {
  it("counts within a window and resets after it", async () => {
    const key = `t:${run}`;
    const l = { limit: 3, windowMs: 60_000 };
    const counts = [];
    for (let i = 0; i < 4; i++) counts.push((await hit(key, l)).allowed);
    expect(counts).toEqual([true, true, true, false]);
    expect((await peek(key, l)).count).toBe(4);
    await db.rateLimit.update({ where: { key }, data: { resetAt: new Date(Date.now() - 1) } });
    expect((await hit(key, l)).count).toBe(1); // new window
    await reset(key);
    expect((await peek(key, l)).count).toBe(0);
  });

  it("is atomic under concurrent hits", async () => {
    const key = `c:${run}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => hit(key, { limit: 10, windowMs: 60_000 })));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(Math.max(...results.map((r) => r.count))).toBe(20);
  });
});

describe("limits in the app", () => {
  let tech: Ctx;
  beforeAll(async () => {
    const u = await db.user.create({ data: { username: `h-tech-${run}`, displayName: `tech ${run}`, role: "TECHNICIAN", source: "LOCAL" } });
    tech = { user: { id: u.id, username: u.username, displayName: u.displayName, role: "TECHNICIAN" } };
  });

  it("caps API calls per token with 429 and Retry-After", async () => {
    const { token, row } = await createToken(tech, { name: "limited", readOnly: "on", expiresInDays: "30" });
    await db.rateLimit.create({ data: { key: `api:${row.id}`, count: LIMITS.api.limit, resetAt: new Date(Date.now() + 30_000) } });
    const r = await meRoute.GET(new Request("https://itdocs.test/api/v1/me", { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({}) });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("limits how many secrets one person can reveal, and audits hitting the cap", async () => {
    const admin = await db.user.create({ data: { username: `h-admin-${run}`, displayName: `admin ${run}`, role: "ADMIN", source: "LOCAL" } });
    const actx: Ctx = { user: { id: admin.id, username: admin.username, displayName: admin.displayName, role: "ADMIN" } };
    const folder = await saveFolder(actx, null, { name: `Limit ${run}` });
    const cred = await createCredential(actx, { folderId: folder.id, title: `Limited ${run}`, password: "pw" });
    await db.rateLimit.create({ data: { key: `reveal:${admin.id}`, count: LIMITS.reveal.limit, resetAt: new Date(Date.now() + 60_000) } });
    const e = await reveal(actx, cred.id, { field: "password" }).catch((x) => x);
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(429);
    expect(await db.auditLog.count({ where: { actorId: admin.id, action: "reveal_limited" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: cred.id, action: "view_sensitive" } })).toBe(0); // nothing revealed
  });
});

describe("middleware", () => {
  it("sends a nonce-based CSP on pages and passes the nonce to Next.js", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = middleware(new NextRequest("https://itdocs.test/dashboard", { headers: { cookie: "itdocs_session=x" } }));
    const policy = res.headers.get("content-security-policy")!;
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'(;|$)/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain("unsafe-eval");
    const other = middleware(new NextRequest("https://itdocs.test/dashboard", { headers: { cookie: "itdocs_session=x" } })).headers.get("content-security-policy");
    expect(other).not.toBe(policy); // fresh nonce per request
    vi.unstubAllEnvs();
  });

  it("redirects pages and rejects internal APIs without a session; leaves the token API and health check open", () => {
    expect(middleware(new NextRequest("https://itdocs.test/assets?q=1")).headers.get("location")).toBe("https://itdocs.test/login?next=%2Fassets%3Fq%3D1");
    expect(middleware(new NextRequest("https://itdocs.test/api/search?q=x")).status).toBe(401);
    expect(middleware(new NextRequest("https://itdocs.test/api/v1/me")).status).toBe(200);
    expect(middleware(new NextRequest("https://itdocs.test/api/health")).status).toBe(200);
  });
});
