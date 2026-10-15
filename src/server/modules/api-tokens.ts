import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit/log";
import { assertCan, can, type Module } from "../rbac/permissions";
import { AppError, FieldError, ForbiddenError, NotFoundError } from "../lib/errors";
import { checkbox } from "../lib/forms";
import type { Ctx } from "../context";

// Personal access tokens for the REST API. A token acts as its owner — same role, same
// permissions — and can be narrowed to read-only and to some modules. Only a SHA-256 hash is
// stored; the plaintext is shown once when created. The vault and admin areas are never
// reachable through the API.

export const API_MODULES = ["assets", "locations", "people", "network", "kb", "software", "vendors", "changes", "reports"] as const satisfies readonly Module[];
export type ApiModule = (typeof API_MODULES)[number];
const MAX_TOKENS_PER_USER = 20;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const tokenInput = z.object({
  name: z.string().trim().min(1, "Give the token a name, e.g. what will use it").max(80),
  readOnly: checkbox,
  scopes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).filter(Boolean))])
    .refine((s) => s.every((m) => (API_MODULES as readonly string[]).includes(m)), "Unknown module"),
  expiresInDays: z.coerce.number().int().refine((n) => [0, 30, 90, 180, 365].includes(n), "Choose an expiry").default(90),
});

export async function createToken(ctx: Ctx, input: unknown) {
  const d = tokenInput.parse(input);
  // Writing is only possible if the owner can write somewhere in the requested scope
  const scope = (d.scopes.length ? d.scopes : [...API_MODULES]) as ApiModule[];
  if (!scope.some((m) => can(ctx.user.role, m, "read"))) throw new FieldError({ scopes: "Your role can't use any of these modules" });
  if (!d.readOnly && !scope.some((m) => can(ctx.user.role, m, "write"))) throw new FieldError({ readOnly: "Your role is read-only — create a read-only token" });
  if ((await db.apiToken.count({ where: { userId: ctx.user.id, revokedAt: null } })) >= MAX_TOKENS_PER_USER) throw new AppError(`You already have ${MAX_TOKENS_PER_USER} active tokens. Revoke one first.`);
  const token = `itd_${crypto.randomBytes(32).toString("base64url")}`;
  return db.$transaction(async (tx) => {
    const row = await tx.apiToken.create({
      data: {
        name: d.name,
        userId: ctx.user.id,
        tokenHash: hash(token),
        prefix: token.slice(0, 10),
        readOnly: d.readOnly,
        scopes: d.scopes,
        expiresAt: d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 86_400_000) : null,
      },
    });
    await audit(tx, ctx, {
      action: "token_create",
      entityType: "ApiToken",
      entityId: row.id,
      summary: `Created API token "${row.name}" (${row.prefix}…, ${row.readOnly ? "read-only" : "read/write"}, ${row.scopes.length ? row.scopes.join(", ") : "all modules"}${row.expiresAt ? `, expires ${row.expiresAt.toISOString().slice(0, 10)}` : ", no expiry"})`,
    });
    return { token, row };
  });
}

/** The caller's tokens, or every token for an admin who asks for all. */
export async function listTokens(ctx: Ctx, all = false) {
  if (all) assertCan(ctx.user.role, "admin", "read");
  return db.apiToken.findMany({
    where: all ? {} : { userId: ctx.user.id },
    select: { id: true, name: true, prefix: true, readOnly: true, scopes: true, expiresAt: true, lastUsedAt: true, lastUsedIp: true, createdAt: true, revokedAt: true, user: { select: { username: true, displayName: true } } },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
  });
}

export async function revokeToken(ctx: Ctx, id: string) {
  const t = await db.apiToken.findUnique({ where: { id } });
  if (!t) throw new NotFoundError("Token");
  if (t.userId !== ctx.user.id && !can(ctx.user.role, "admin", "write")) throw new ForbiddenError();
  if (t.revokedAt) return;
  await db.$transaction(async (tx) => {
    await tx.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(tx, ctx, { action: "token_revoke", entityType: "ApiToken", entityId: id, summary: `Revoked API token "${t.name}" (${t.prefix}…)${t.userId !== ctx.user.id ? " belonging to another user" : ""}` });
  });
}

export type TokenAuth = { ctx: Ctx; token: { id: string; prefix: string; readOnly: boolean; scopes: string[] } };

/**
 * Resolves "Authorization: Bearer itd_…" to the owner's context. Returns null for a missing,
 * unknown, revoked or expired token, or a disabled owner — the caller answers 401 either way.
 */
export async function authenticateToken(authorization: string | null, meta: { ip?: string; userAgent?: string }): Promise<TokenAuth | null> {
  const m = /^Bearer\s+(itd_[A-Za-z0-9_-]{20,100})\s*$/.exec(authorization ?? "");
  if (!m) return null;
  const t = await db.apiToken.findUnique({ where: { tokenHash: hash(m[1]) }, include: { user: true } });
  const now = new Date();
  if (!t || t.revokedAt || (t.expiresAt && t.expiresAt <= now) || !t.user.active) return null;
  // Record use at most once a minute per token, to keep reads cheap
  if (!t.lastUsedAt || now.getTime() - t.lastUsedAt.getTime() > 60_000 || t.lastUsedIp !== (meta.ip ?? null))
    await db.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: now, lastUsedIp: meta.ip ?? null } }).catch(() => {});
  return {
    ctx: {
      user: { id: t.user.id, username: t.user.username, displayName: t.user.displayName, role: t.user.role },
      ip: meta.ip,
      userAgent: `api:${t.prefix} ${meta.userAgent ?? ""}`.trim(),
    },
    token: { id: t.id, prefix: t.prefix, readOnly: t.readOnly, scopes: t.scopes },
  };
}

/** Can this token use a module at this level? (The owner's role is checked again by the module.) */
export function tokenAllows(t: TokenAuth["token"], module: ApiModule, need: "read" | "write") {
  if (need === "write" && t.readOnly) return false;
  return t.scopes.length === 0 || t.scopes.includes(module);
}
