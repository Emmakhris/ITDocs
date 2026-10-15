import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "../db";

// Fixed-window rate limiting backed by Postgres, so limits are shared by every app instance and
// survive restarts. One atomic upsert per check: the window resets when it has expired.

export type Limit = { limit: number; windowMs: number };
export type LimitResult = { allowed: boolean; count: number; remaining: number; resetAt: Date; retryAfterSec: number };

/** Policies used across the app. API limits can be tuned with API_RATE_LIMIT (requests/minute). */
export const LIMITS = {
  /** Failed sign-ins per username + IP before a 15-minute lockout */
  loginFailures: { limit: 5, windowMs: 15 * 60_000 },
  /** All sign-in attempts from one IP (stops password spraying across usernames) */
  loginPerIp: { limit: 50, windowMs: 15 * 60_000 },
  /** REST API requests per token */
  api: { limit: Number(process.env.API_RATE_LIMIT) || 600, windowMs: 60_000 },
  /** Vault reveals / copies per user (stops bulk scraping of secrets) */
  reveal: { limit: 60, windowMs: 10 * 60_000 },
  /** Search-as-you-type and lookup calls per user */
  search: { limit: 240, windowMs: 60_000 },
} satisfies Record<string, Limit>;

/** Counts one hit against `key`. Never throws: if the database is unavailable the request is allowed. */
export async function hit(key: string, l: Limit): Promise<LimitResult> {
  const now = new Date();
  try {
    const [row] = await db.$queryRaw<{ count: number; resetAt: Date }[]>(Prisma.sql`
      INSERT INTO "RateLimit" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${new Date(now.getTime() + l.windowMs)})
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN ${new Date(now.getTime() + l.windowMs)} ELSE "RateLimit"."resetAt" END
      RETURNING "count", "resetAt"`);
    return result(row.count, row.resetAt, l, now);
  } catch (e) {
    console.error("[rate-limit] check failed, allowing request:", (e as Error).message);
    return result(0, new Date(now.getTime() + l.windowMs), l, now);
  }
}

/** Reads the current count without adding to it. */
export async function peek(key: string, l: Limit): Promise<LimitResult> {
  const now = new Date();
  const row = await db.rateLimit.findUnique({ where: { key } }).catch(() => null);
  if (!row || row.resetAt <= now) return result(0, new Date(now.getTime() + l.windowMs), l, now);
  return result(row.count, row.resetAt, l, now);
}

export async function reset(key: string) {
  await db.rateLimit.deleteMany({ where: { key } }).catch(() => {});
}

/** Removes expired windows; called by the scheduler. */
export async function sweep() {
  return db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } });
}

function result(count: number, resetAt: Date, l: Limit, now: Date): LimitResult {
  return { allowed: count <= l.limit, count, remaining: Math.max(0, l.limit - count), resetAt, retryAfterSec: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)) };
}
