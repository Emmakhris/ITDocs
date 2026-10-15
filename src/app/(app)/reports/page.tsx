import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { reportsFor } from "@/server/modules/reports";
import { listSubscriptions, reportTitle } from "@/server/modules/alerts";
import { Card, Empty, PageHeader, fmtDateTime } from "@/components/ui";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "reports", "read");
  const reports = reportsFor(ctx);
  const subs = await listSubscriptions(ctx);
  const categories = [...new Set(reports.map((r) => r.category))];

  return (
    <>
      <PageHeader title="Reports" subtitle="Built-in reports. Open one to filter it, export to CSV or Excel, print or save as PDF, or email it on a schedule." />
      {reports.length === 0 ? (
        <Empty title="No reports available for your role" />
      ) : (
        <div className="space-y-6">
          {categories.map((c) => (
            <section key={c}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{c}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {reports.filter((r) => r.category === c).map((r) => (
                  <li key={r.key}>
                    <Link href={`/reports/${r.key}`} className="flex h-full gap-3 rounded-lg border border-line bg-surface p-4 hover:border-brand hover:bg-brand-soft/40">
                      <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-medium">{r.title}</span>
                        <span className="mt-1 block text-sm text-muted">{r.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {subs.length > 0 && (
            <Card title={`Scheduled reports (${subs.length})`}>
              <ul className="divide-y divide-line text-sm">
                {subs.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                    <Link href={`/reports/${s.reportKey}`} className="font-medium text-brand hover:underline">{reportTitle(s.reportKey)}</Link>
                    <span className="text-muted">{s.frequency.toLowerCase()} · {s.format} · {s.recipients.join(", ")}</span>
                    <span className="ml-auto text-xs text-muted">next {fmtDateTime(s.nextRunAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
