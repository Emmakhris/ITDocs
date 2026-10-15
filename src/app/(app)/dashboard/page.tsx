import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { dashboardData } from "@/server/modules/dashboard";
import { reviewDueCount } from "@/server/modules/kb";
import { renewals } from "@/server/modules/vendors";
import { overAllocated } from "@/server/modules/software";
import { openIncidents } from "@/server/modules/incidents";
import { upcomingChanges } from "@/server/modules/changes";
import { changeNo, incidentNo } from "@/server/lib/workflow";
import { can } from "@/server/rbac/permissions";
import { Card, PageHeader, LinkButton, STATUS_META, fmtDate, fmtDateTime, Badge } from "@/components/ui";
import type { AssetStatus } from "@prisma/client";

export const metadata = { title: "Dashboard" };

function Stat({ label, value, href, tone }: { label: string; value: number; href: string; tone?: "warn" | "danger" }) {
  return (
    <Link href={href} className="rounded-lg border border-line bg-surface p-4 hover:border-brand">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "danger" && value ? "text-danger" : tone === "warn" && value ? "text-warn" : ""}`}>
        {value.toLocaleString()}
      </p>
    </Link>
  );
}

const daysFrom = (d: Date | null) => (d ? Math.round((d.getTime() - Date.now()) / 86_400_000) : 0);

export default async function Dashboard() {
  const ctx = await requireCtx();
  const [d, kbDue, due, over, incidents, changes] = await Promise.all([dashboardData(ctx), reviewDueCount(ctx), renewals(ctx, 60), overAllocated(ctx), openIncidents(ctx), upcomingChanges(ctx, 7)]);
  const writable = can(ctx.user.role, "assets", "write");
  const statuses = Object.keys(STATUS_META) as AssetStatus[];
  const max = Math.max(1, ...statuses.map((s) => d.byStatus[s] ?? 0));

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome back, ${ctx.user.displayName}`}
        actions={
          writable && (
            <>
              <LinkButton href="/scan">Scan a tag</LinkButton>
              <LinkButton href="/assets/new" variant="primary">New asset</LinkButton>
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total assets" value={d.total} href="/assets" />
        <Stat label="Deployed" value={d.byStatus.DEPLOYED ?? 0} href="/assets?status=DEPLOYED" />
        <Stat label="In stock" value={d.byStatus.IN_STOCK ?? 0} href="/assets?status=IN_STOCK" />
        <Stat label="PHI devices" value={d.phi} href="/assets?phi=1" />
        <Stat label="Overdue check-outs" value={d.overdue.length} href="/checkouts?overdue=1" tone="danger" />
        <Stat label="Lost" value={d.byStatus.LOST ?? 0} href="/assets?status=LOST" tone="danger" />
      </div>

      {(incidents.length > 0 || changes.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {incidents.length > 0 && (
            <Card title={`Open incidents (${incidents.length})`} actions={<Link className="text-xs text-brand hover:underline" href="/changes/incidents">All incidents</Link>}>
              <ul className="divide-y divide-line text-sm">
                {incidents.slice(0, 8).map((i) => (
                  <li key={i.id} className="flex items-center gap-2 py-1.5">
                    <Badge tone={i.severity === "P1" || i.severity === "P2" ? "red" : "amber"}>{i.severity}</Badge>
                    <Link href={`/changes/incidents/${i.id}`} className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono text-xs">{incidentNo(i.number)}</span> {i.title}</Link>
                    <span className="text-xs text-muted">{i.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {changes.length > 0 && (
            <Card title="Changes in the next 7 days" actions={<Link className="text-xs text-brand hover:underline" href="/changes?view=upcoming">Schedule</Link>}>
              <ul className="divide-y divide-line text-sm">
                {changes.slice(0, 8).map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-1.5">
                    <Link href={`/changes/${c.id}`} className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono text-xs">{changeNo(c.number)}</span> {c.title}</Link>
                    <span className="whitespace-nowrap text-xs text-muted">{fmtDateTime(c.plannedStart)}</span>
                    {c.status !== "APPROVED" && c.status !== "IN_PROGRESS" && <Badge tone="amber">not approved</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {kbDue > 0 && (
        <p className="mt-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          {kbDue} knowledge-base article{kbDue === 1 ? " is" : "s are"} due for review.{" "}
          <Link href="/kb?view=review" className="font-medium underline">Review now</Link>
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Assets by status">
          <ul className="space-y-2">
            {statuses.map((s) => (
              <li key={s}>
                <Link href={`/assets?status=${s}`} className="group block">
                  <div className="flex justify-between text-xs">
                    <span className="group-hover:underline">{STATUS_META[s].label}</span>
                    <span className="tabular-nums text-muted">{d.byStatus[s] ?? 0}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-surface-2">
                    <div className="h-1.5 rounded bg-brand" style={{ width: `${((d.byStatus[s] ?? 0) / max) * 100}%` }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Warranties ending in 90 days" actions={<Link className="text-xs text-brand hover:underline" href="/assets?warranty=90">View all</Link>}>
          {d.warranty.length ? (
            <ul className="divide-y divide-line text-sm">
              {d.warranty.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/assets/${a.id}`} className="min-w-0 truncate hover:underline">
                    <span className="font-mono text-xs">{a.tag}</span> {a.name}
                  </Link>
                  <Badge tone={daysFrom(a.warrantyEnd) < 30 ? "red" : "amber"}>{daysFrom(a.warrantyEnd)}d</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing expiring soon.</p>
          )}
        </Card>

        <Card title="Preventive maintenance due (30 days)">
          {d.pmDue.length ? (
            <ul className="divide-y divide-line text-sm">
              {d.pmDue.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/assets/${a.id}`} className="min-w-0 truncate hover:underline">
                    <span className="font-mono text-xs">{a.tag}</span> {a.name}
                  </Link>
                  <Badge tone={daysFrom(a.nextPmDate) < 0 ? "red" : "amber"}>
                    {daysFrom(a.nextPmDate) < 0 ? `${-daysFrom(a.nextPmDate)}d overdue` : fmtDate(a.nextPmDate)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No maintenance due.</p>
          )}
        </Card>
      </div>

      {(due.length > 0 || over.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {due.length > 0 && (
            <Card title="Renewals in the next 60 days" actions={<Link className="text-xs text-brand hover:underline" href="/vendors?tab=renewals">All renewals</Link>}>
              <ul className="divide-y divide-line text-sm">
                {due.slice(0, 8).map((r) => (
                  <li key={r.kind + r.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={r.href} className="min-w-0 truncate hover:underline">
                      {r.title} <span className="text-xs text-muted">{r.what.toLowerCase()}</span>
                    </Link>
                    <Badge tone={r.daysLeft < 0 ? "red" : r.daysLeft <= 14 ? "amber" : "gray"}>{r.daysLeft < 0 ? `${-r.daysLeft}d ago` : fmtDate(r.due)}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {over.length > 0 && (
            <Card title="Over-allocated licences" actions={<Link className="text-xs text-brand hover:underline" href="/software?issues=1">Compliance</Link>}>
              <ul className="divide-y divide-line text-sm">
                {over.slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                    <Link href={`/software/licenses/${l.id}`} className="min-w-0 truncate hover:underline">{l.title}</Link>
                    <Badge tone="red">+{l.over} seats</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent movements" actions={<Link className="text-xs text-brand hover:underline" href="/movements">Full log</Link>}>
          <ul className="divide-y divide-line text-sm">
            {d.recent.map((m) => (
              <li key={m.id} className="py-2">
                <div className="flex justify-between gap-2">
                  <Link href={`/assets/${m.asset.id}`} className="truncate font-medium hover:underline">
                    {m.asset.tag} · {m.asset.name}
                  </Link>
                  <span className="shrink-0 text-xs text-muted">{fmtDateTime(m.movedAt)}</span>
                </div>
                <p className="truncate text-xs text-muted">
                  {m.fromLocationPath ?? "—"} → {m.toLocationPath ?? "—"} · {m.movedByName}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Overdue check-outs" actions={<Link className="text-xs text-brand hover:underline" href="/checkouts">All check-outs</Link>}>
          {d.overdue.length ? (
            <ul className="divide-y divide-line text-sm">
              {d.overdue.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 py-1.5">
                  <Link href={`/assets/${c.asset.id}`} className="truncate hover:underline">
                    {c.asset.tag} · {c.person.name}
                  </Link>
                  <Badge tone="red">due {fmtDate(c.dueAt)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No overdue loans.</p>
          )}
        </Card>
      </div>
    </>
  );
}
