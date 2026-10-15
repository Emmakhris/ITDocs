import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { audit } from "@/server/audit/log";
import { auditCsvRows } from "@/server/modules/audit-query";
import { db } from "@/server/db";
import { csvResponse } from "@/server/lib/csv";

export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx || !can(ctx.user.role, "audit", "read")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const d = (s: string | null, end = false) => (s ? new Date(s + (end ? "T23:59:59.999" : "T00:00:00")) : undefined);
  const f = {
    q: sp.get("q") ?? undefined,
    action: sp.get("action") ?? undefined,
    entityType: sp.get("entityType") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    actor: sp.get("actor") ?? undefined,
    from: d(sp.get("from")),
    to: d(sp.get("to"), true),
  };
  await audit(db, ctx, { action: "export", entityType: "AuditLog", summary: `Exported audit log (${sp.toString() || "all"})` });
  async function* rows() {
    for await (const r of auditCsvRows(ctx!, f))
      yield [r.id.toString(), r.at, r.actorName, r.action, r.entityType, r.entityId, r.summary, r.ip, r.before ? JSON.stringify(r.before) : "", r.after ? JSON.stringify(r.after) : ""];
  }
  return csvResponse(`audit-${new Date().toISOString().slice(0, 10)}.csv`, ["id", "at", "user", "action", "entityType", "entityId", "summary", "ip", "before", "after"], rows());
}
