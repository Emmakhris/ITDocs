import Link from "next/link";
import type { ChangeStatus } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listChanges, upcomingChanges, type ChangeView } from "@/server/modules/changes";
import { changeNo } from "@/server/lib/workflow";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Table, cx, fmtDateTime } from "@/components/ui";
import { CHANGE_STATUS, RISK, SectionTabs, StatusBadge } from "./shared";

export const metadata = { title: "Changes" };

const VIEWS: { key: ChangeView; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "upcoming", label: "Scheduled" },
  { key: "recent", label: "Last 30 days" },
  { key: "all", label: "All" },
];

export default async function ChangesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; status?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "changes", "read");
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? "open") as ChangeView;
  const status = sp.status && sp.status in CHANGE_STATUS ? (sp.status as ChangeStatus) : undefined;
  const [rows, week] = await Promise.all([listChanges(ctx, { q: sp.q, view, status }), upcomingChanges(ctx, 7)]);
  const writable = can(ctx.user.role, "changes", "write");
  const awaiting = rows.filter((r) => r.status === "SUBMITTED").length;

  return (
    <>
      <PageHeader
        title="Changes & incidents"
        subtitle="Planned changes with approval, incidents with timelines, and the daily tech journal."
        actions={
          writable && (
            <>
              <LinkButton href="/changes/incidents/new">Report incident</LinkButton>
              <LinkButton href="/changes/new" variant="primary">New change</LinkButton>
            </>
          )
        }
      />
      <SectionTabs active="/changes" />

      {week.length > 0 && (
        <Card title="Change windows in the next 7 days" className="mb-4">
          <ul className="divide-y divide-line text-sm">
            {week.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="w-56 shrink-0 tabular-nums text-muted">{fmtDateTime(c.plannedStart)} – {c.plannedEnd && c.plannedStart && c.plannedEnd.toDateString() === c.plannedStart.toDateString() ? c.plannedEnd.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : fmtDateTime(c.plannedEnd)}</span>
                <Link href={`/changes/${c.id}`} className="min-w-0 flex-1 truncate text-brand hover:underline"><span className="font-mono text-xs">{changeNo(c.number)}</span> {c.title}</Link>
                <Badge tone={RISK[c.risk].tone}>{RISK[c.risk].label}</Badge>
                <StatusBadge s={c.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-line bg-surface p-0.5 text-sm">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`/changes?view=${v.key}`} className={cx("rounded px-2.5 py-1", v.key === view && !status ? "bg-brand text-brand-fg" : "text-muted hover:text-fg")}>{v.label}</Link>
          ))}
        </div>
        {awaiting > 0 && <Link href="/changes?view=all&status=SUBMITTED" className="text-sm text-brand hover:underline">{awaiting} awaiting approval</Link>}
        <form className="ml-auto grid gap-2 sm:grid-cols-[minmax(0,18rem)_auto]">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={sp.q} placeholder="Title, CHG number or ticket…" aria-label="Search changes" />
          <Button variant="secondary">Search</Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title="No changes here">{writable && <>Plan one with <Link href="/changes/new" className="text-brand hover:underline">New change</Link>.</>}</Empty>
      ) : (
        <Table>
          <thead><tr><th>Change</th><th>Window</th><th>Risk</th><th>Status</th><th>Requested by</th><th>Approved by</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/changes/${c.id}`} className="text-brand hover:underline"><span className="font-mono text-xs">{changeNo(c.number)}</span> {c.title}</Link>
                  {c.type !== "NORMAL" && <Badge className="ml-1" tone={c.type === "EMERGENCY" ? "red" : "gray"}>{c.type.toLowerCase()}</Badge>}
                </td>
                <td className="whitespace-nowrap text-xs">{c.plannedStart ? fmtDateTime(c.plannedStart) : <span className="text-muted">not scheduled</span>}</td>
                <td><Badge tone={RISK[c.risk].tone}>{c.risk.toLowerCase()}</Badge></td>
                <td><StatusBadge s={c.status} /></td>
                <td>{c.requesterName}</td>
                <td>{c.approverName ?? <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
