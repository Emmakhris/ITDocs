import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "../db";
import type { Ctx } from "../context";

export const SESSION_COOKIE = "itdocs_session";
const IDLE_MS = Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60_000;
const MAX_MS = Number(process.env.SESSION_MAX_HOURS ?? 12) * 3_600_000;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || undefined;
  return { ip, userAgent: h.get("user-agent") ?? undefined };
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const meta = await requestMeta();
  await db.session.create({
    data: { id: hash(token), userId, expiresAt: new Date(Date.now() + MAX_MS), ...meta },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: MAX_MS / 1000,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: hash(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Current user context, or null. Cached per request. Enforces idle + absolute timeouts. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = hash(token);
  const s = await db.session.findUnique({ where: { id }, include: { user: true } });
  const now = Date.now();
  if (!s || !s.user.active || s.expiresAt.getTime() < now || now - s.lastSeenAt.getTime() > IDLE_MS) {
    if (s) await db.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  if (now - s.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }
  const meta = await requestMeta();
  return {
    user: { id: s.user.id, username: s.user.username, displayName: s.user.displayName, role: s.user.role },
    ...meta,
  };
});

/** For pages/actions: returns the ctx or redirects to login. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}
