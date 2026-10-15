import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { authenticateToken, tokenAllows, type ApiModule, type TokenAuth } from "../modules/api-tokens";
import { AppError, FieldError } from "../lib/errors";
import { issueMessage } from "../lib/forms";
import { LIMITS, hit } from "../lib/rate-limit";
import type { Ctx } from "../context";

// Shared plumbing for /api/v1 route handlers: bearer-token auth (never the session cookie, so
// browsers can't be tricked into making API calls), scope checks, JSON parsing with a size cap,
// and one error format: { error, fieldErrors? }.

export type ApiArgs<P> = { ctx: Ctx; token: TokenAuth["token"]; req: Request; url: URL; params: P };
type Handler<P> = (a: ApiArgs<P>) => Promise<unknown>;

const MAX_BODY = 1_000_000;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new NextResponse(JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export const apiError = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

function meta(req: Request) {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: fwd || req.headers.get("x-real-ip") || undefined, userAgent: req.headers.get("user-agent")?.slice(0, 200) || undefined };
}

/** Reads a JSON object body (max 1 MB). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) throw new AppError("Send a JSON body with Content-Type: application/json.", 415);
  const text = await req.text();
  if (text.length > MAX_BODY) throw new AppError("Request body too large.", 413);
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new AppError("Body is not a JSON object.", 400);
  }
}


/** `module` null = any valid token (endpoints that filter by scope themselves, like /me and /search). */
export function api<P = Record<string, never>>(module: ApiModule | null, need: "read" | "write", handler: Handler<P>) {
  return async (req: Request, ctxArg: { params: Promise<P> }) => {
    const auth = await authenticateToken(req.headers.get("authorization"), meta(req));
    if (!auth) {
      const r = apiError(401, "Missing, invalid, expired or revoked API token. Send Authorization: Bearer itd_…");
      r.headers.set("WWW-Authenticate", 'Bearer realm="itdocs"');
      return r;
    }
    // Per-token rate limit (API_RATE_LIMIT requests per minute, default 600)
    const rl = await hit(`api:${auth.token.id}`, LIMITS.api);
    const rlHeaders = { "X-RateLimit-Limit": String(LIMITS.api.limit), "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(Math.ceil(rl.resetAt.getTime() / 1000)) };
    if (!rl.allowed) return json({ error: `Rate limit exceeded: ${LIMITS.api.limit} requests per minute per token.` }, 429, { ...rlHeaders, "Retry-After": String(rl.retryAfterSec) });
    if (module && !tokenAllows(auth.token, module, need))
      return apiError(403, need === "write" && auth.token.readOnly ? "This token is read-only." : `This token is not allowed to use "${module}".`);
    try {
      const url = new URL(req.url);
      const result = await handler({ ctx: auth.ctx, token: auth.token, req, url, params: await ctxArg.params });
      if (result instanceof Response) return result;
      return json(result ?? { ok: true }, req.method === "POST" ? 201 : 200, rlHeaders);
    } catch (e) {
      return toApiError(e);
    }
  };
}

export function toApiError(e: unknown) {
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of e.issues) fieldErrors[i.path.join(".") || "_"] ??= issueMessage(i);
    return apiError(422, "Validation failed.", { fieldErrors });
  }
  if (e instanceof FieldError) return apiError(422, e.message, { fieldErrors: e.fieldErrors });
  if (e instanceof AppError) return apiError(e.status, e.message);
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return apiError(409, "That value is already in use.");
  console.error("[api]", e);
  return apiError(500, "Internal error. It has been logged.");
}

/** page / pageSize query parameters with sane bounds. */
export function paging(url: URL, max = 200) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(max, Math.max(1, Number(url.searchParams.get("pageSize")) || 50));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
