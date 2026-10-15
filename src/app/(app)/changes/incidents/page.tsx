import Link from "next/link";
import type { IncidentSeverity } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listIncidents } from "@/server/modules/incidents";
import { duration, incidentNo } from "@/server/lib/workflow";
import { Button, Empty, Input, LinkButton, PageHeader, Table, cx, fmtDateTime } from "@/components/ui";
import { IncidentBadge, SEVERITY, SectionTabs, SeverityBadge } from "../shared";

export const metadata = { title: "Incidents" };

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "recent", label: "Last 30 days" },
  { key: "all", label: "All" },
] as const;

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; severity?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "changes", "read");
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view)?.key ?? "open";
  const severity = sp.severity && sp.severity in SEVERITY ? (sp.severity as IncidentSeverity) : undefined;
  const rows = await listIncidents(ctx, { q: sp.q, view, severity });
  const writable = can(ctx.user.role, "changes", "write");

  return (
    <>
      <PageHeader
        title="Changes & incidents"
        subtitle="Planned changes with approval, incidents with timelines, and the daily tech journal."
        actions={writable && <LinkButton href="/changes/incidents/new" variant="primary">Report incident</LinkButton>}
      />
      <SectionTabs active="/changes/incidents" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-line bg-surface p-0.5 text-sm">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`/changes/incidents?view=${v.key}`} className={cx("rounded px-2.5 py-1", v.key === view ? "bg-brand text-brand-fg" : "text-muted hover:text-fg")}>{v.label}</Link>
          ))}
        </div>
        <div className="flex gap-1 text-sm">
          {Object.keys(SEVERITY).map((s) => (
            <Link key={s} href={severity === s ? `/changes/incidents?view=${view}` : `/changes/incidents?view=${view}&severity=${s}`} className={cx("rounded px-2 py-1", severity === s ? "bg-brand text-brand-fg" : "text-muted hover:text-fg")}>{s}</Link>
          ))}
        </div>
        <form className="ml-auto grid gap-2 sm:grid-cols-[minmax(0,18rem)_auto]">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={sp.q} placeholder="Title, INC number, root cause…" aria-label="Search incidents" />
          <Button variant="secondary">Search</Button>
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty title={view === "open" ? "No open incidents" : "No incidents found"}>{view === "open" && "All quiet."}</Empty>
      ) : (
        <Table>
          <thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Started</th><th>Time to mitigate</th><th>Time to resolve</th><th>Owner</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/changes/incidents/${i.id}`} className="text-brand hover:underline"><span className="font-mono text-xs">{incidentNo(i.number)}</span> {i.title}</Link></td>
                <td><SeverityBadge s={i.severity} /></td>
                <td><IncidentBadge s={i.status} /></td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(i.startedAt)}</td>
                <td className="text-xs">{duration(i.startedAt, i.mitigatedAt) ?? <span className="text-muted">—</span>}</td>
                <td className="text-xs">{duration(i.startedAt, i.resolvedAt) ?? <span className="text-muted">—</span>}</td>
                <td>{i.owner?.displayName ?? <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
