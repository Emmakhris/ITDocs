import type { Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import type { Ctx } from "../context";

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
};

const SECRET_KEYS = /password|secret|hash|token|totp/i;

/** Strip secrets and reduce to JSON-safe values before storing. */
function sanitize(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => {
      if (k && SECRET_KEYS.test(k)) return val ? "[redacted]" : val;
      if (typeof val === "bigint") return val.toString();
      return val;
    }),
  );
}

/** Return only the keys that changed between two snapshots. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === "updatedAt") continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

export async function audit(tx: Tx | typeof db, ctx: Ctx | null, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: ctx?.user?.id || null,
      actorName: ctx?.user?.displayName ?? "system",
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      summary: e.summary,
      before: sanitize(e.before),
      after: sanitize(e.after),
      ip: ctx?.ip,
      userAgent: ctx?.userAgent?.slice(0, 300),
    },
  });
}
