import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/session";
import { db } from "@/server/db";
import { audit } from "@/server/audit/log";
import { runReport } from "@/server/modules/reports";
import { buildXlsx } from "@/server/lib/xlsx";
import { csvResponse } from "@/server/lib/csv";
import { AppError } from "@/server/lib/errors";

/** Report export: ?format=csv|xlsx plus the report's own parameters. Every export is audited. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  try {
    const r = await runReport(ctx, (await params).key, Object.fromEntries(url.searchParams));
    await audit(db, ctx, { action: "export", entityType: "Report", entityId: r.def.key, summary: `Exported "${r.def.title}" as ${format.toUpperCase()} (${r.rows.length} rows)`, after: r.params });
    const name = `${r.def.key}-${new Date().toISOString().slice(0, 10)}`;
    if (format === "csv") return csvResponse(`${name}.csv`, r.columns, r.rows);
    return new NextResponse(new Uint8Array(buildXlsx(r.def.title, r.columns, r.rows)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
