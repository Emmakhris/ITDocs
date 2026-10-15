import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listSoftware } from "@/server/modules/software";
import { vendorOptions } from "@/server/modules/vendors";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Table, fmtDate } from "@/components/ui";
import { saveSoftwareAction } from "./actions";
import { SoftwareForm } from "./forms";

export const metadata = { title: "Software & licences" };

export default async function SoftwarePage({ searchParams }: { searchParams: Promise<{ q?: string; edit?: string; issues?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "software", "read");
  const sp = await searchParams;
  const writable = can(ctx.user.role, "software", "write");
  const [rows, vendors] = await Promise.all([listSoftware(ctx, { q: sp.q, issues: sp.issues === "1" }), writable && sp.edit === "new" ? vendorOptions() : []]);
  const issues = rows.filter((r) => r.summary.over > 0).length;

  return (
    <>
      <PageHeader
        title="Software & licences"
        subtitle="What you're licensed for, who and what is using each seat, and when it renews."
        actions={writable && <LinkButton href="/software?edit=new" variant="primary">Add software</LinkButton>}
      />
      {writable && sp.edit === "new" && (
        <Card title="Add software" className="mb-4"><SoftwareForm action={saveSoftwareAction.bind(null, null)} vendors={vendors} cancelHref="/software" /></Card>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="grid gap-2 sm:grid-cols-[minmax(0,22rem)_auto]">
          <Input name="q" defaultValue={sp.q} placeholder="Name, category or vendor…" aria-label="Search software" />
          <Button variant="secondary">Search</Button>
        </form>
        <Link href={sp.issues === "1" ? "/software" : "/software?issues=1"} className="ml-auto text-sm text-brand hover:underline">
          {sp.issues === "1" ? "Show all" : `Show only compliance issues${issues ? ` (${issues})` : ""}`}
        </Link>
      </div>
      {rows.length === 0 ? (
        <Empty title={sp.q || sp.issues ? "Nothing matches" : "No software yet"}>
          {sp.issues ? "No over-allocated or expired licences." : "Add the applications you license, then record each licence and who uses it."}
        </Empty>
      ) : (
        <Table>
          <thead><tr><th>Software</th><th>Vendor</th><th>Licences</th><th>Seats used</th><th>Next renewal</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/software/${s.id}`} className="font-medium text-brand hover:underline">{s.name}</Link>
                  {s.category && <span className="block text-xs text-muted">{s.category}</span>}
                </td>
                <td>{s.vendor ? <Link href={`/vendors/${s.vendor.id}`} className="hover:underline">{s.vendor.name}</Link> : <span className="text-muted">—</span>}</td>
                <td>{s.summary.licenses}</td>
                <td className="tabular-nums">{s.summary.used} / {s.summary.seats ?? "∞"}</td>
                <td className="whitespace-nowrap">{fmtDate(s.summary.nextExpiry) ?? <span className="text-muted">—</span>}</td>
                <td className="space-x-1 text-right">
                  {s.summary.over > 0 && <Badge tone="red">Over by {s.summary.over}</Badge>}
                  {s.summary.expired > 0 && <Badge tone="amber">{s.summary.expired} expired</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
