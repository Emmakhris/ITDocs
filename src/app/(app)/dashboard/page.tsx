import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { dashboardData } from "@/server/modules/dashboard";
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
  const d = await dashboardData(ctx);
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
