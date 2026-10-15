import { NextResponse } from "next/server";
import { LIMITS, hit } from "@/server/lib/rate-limit";
import { getCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { db } from "@/server/db";
import { accessibleFolderIds } from "@/server/modules/vault";

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rl = await hit(`search:${ctx.user.id}`, LIMITS.search);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const { kind } = await params;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const ci = { contains: q, mode: "insensitive" as const };

  if (kind === "people" && can(ctx.user.role, "people", "read")) {
    const rows = await db.person.findMany({
      where: { deletedAt: null, active: true, ...(q ? { OR: [{ name: ci }, { email: ci }, { employeeId: ci }] } : {}) },
      include: { department: true },
      orderBy: { name: "asc" },
      take: 20,
    });
    return NextResponse.json(rows.map((p) => ({ id: p.id, label: p.name, sub: [p.department?.name, p.email].filter(Boolean).join(" · ") })));
  }
  if (kind === "assets" && can(ctx.user.role, "assets", "read")) {
    const rows = await db.asset.findMany({
      where: { deletedAt: null, ...(q ? { OR: [{ tag: ci }, { name: ci }, { serial: ci }, { hostname: ci }] } : {}) },
      orderBy: { tag: "asc" },
      take: 20,
    });
    return NextResponse.json(rows.map((a) => ({ id: a.id, label: `${a.tag} · ${a.name}`, sub: a.serial ?? undefined })));
  }
  if (kind === "credentials" && can(ctx.user.role, "vault", "read")) {
    // Titles only, from folders this user may open — never secrets
    const rows = await db.credential.findMany({
      where: { deletedAt: null, folderId: { in: await accessibleFolderIds(ctx) }, ...(q ? { OR: [{ title: ci }, { username: ci }] } : {}) },
      include: { folder: { select: { name: true } } },
      orderBy: { title: "asc" },
      take: 20,
    });
    return NextResponse.json(rows.map((c) => ({ id: c.id, label: c.title, sub: [c.folder.name, c.username].filter(Boolean).join(" · ") })));
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
