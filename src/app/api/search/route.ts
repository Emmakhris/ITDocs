import { NextResponse } from "next/server";
import { LIMITS, hit } from "@/server/lib/rate-limit";
import { getCtx } from "@/server/auth/session";
import { globalSearch } from "@/server/modules/search";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rl = await hit(`search:${ctx.user.id}`, LIMITS.search);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json(await globalSearch(ctx, q.slice(0, 100)));
}
