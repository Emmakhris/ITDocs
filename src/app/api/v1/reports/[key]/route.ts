import { api, apiError } from "@/server/api/handler";
import { getReportDef, runReport } from "@/server/modules/reports";

/** Run a built-in report and get its rows as JSON. Parameters as in the UI (e.g. ?days=90). Vault and audit reports are not available. */
export const GET = api<{ key: string }>("reports", "read", async ({ ctx, url, params }) => {
  const def = getReportDef(ctx, params.key);
  if (def.module === "vault" || def.module === "audit") return apiError(403, "This report is not available through the API.");
  const r = await runReport(ctx, params.key, Object.fromEntries(url.searchParams));
  return { key: r.def.key, title: r.def.title, params: r.params, summary: r.summary ?? null, columns: r.columns, rows: r.rows };
});
