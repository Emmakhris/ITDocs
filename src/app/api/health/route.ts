import { NextResponse } from "next/server";
import { db } from "@/server/db";

/** Liveness / readiness for load balancers and Docker healthchecks. Reveals nothing but up/down. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
