import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { db } from "@/server/db";
import { Badge, Empty, LinkButton, PageHeader, Table, fmtDate } from "@/components/ui";

export const metadata = { title: "Check-outs" };

export default async function CheckoutsPage({ searchParams }: { searchParams: Promise<{ overdue?: string; history?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "assets", "read");
  const sp = await searchParams;
  const now = new Date();
  const rows = await db.checkout.findMany({
    where: sp.history ? {} : { returnedAt: null, ...(sp.overdue ? { dueAt: { lt: now } } : {}) },
    include: { asset: true, person: true, checkedOutBy: true },
    orderBy: sp.history ? { outAt: "desc" } : [{ dueAt: { sort: "asc", nulls: "last" } }],
    take: 500,
  });

  return (
    <>
      <PageHeader
        title="Check-outs"
        subtitle={sp.history ? "All loans, newest first" : sp.overdue ? "Overdue loans" : "Devices currently on loan"}
        actions={
          <>
            <LinkButton href="/checkouts" variant={!sp.overdue && !sp.history ? "primary" : "secondary"}>On loan</LinkButton>
            <LinkButton href="/checkouts?overdue=1" variant={sp.overdue ? "primary" : "secondary"}>Overdue</LinkButton>
            <LinkButton href="/checkouts?history=1" variant={sp.history ? "primary" : "secondary"}>History</LinkButton>
          </>
        }
      />
      {rows.length === 0 ? (
        <Empty title="Nothing here">Check out a device from its asset page.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Borrower</th>
              <th>Out</th>
              <th>Due</th>
              <th>Returned</th>
              <th className="hidden md:table-cell">Issued by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const overdue = !c.returnedAt && c.dueAt && c.dueAt < now;
              return (
                <tr key={c.id}>
                  <td>
                    <Link className="text-brand hover:underline" href={`/assets/${c.asset.id}`}>
                      <span className="font-mono text-xs">{c.asset.tag}</span> {c.asset.name}
                    </Link>
                  </td>
                  <td><Link className="hover:underline" href={`/people/${c.person.id}`}>{c.person.name}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(c.outAt)}</td>
                  <td className="whitespace-nowrap">{overdue ? <Badge tone="red">{fmtDate(c.dueAt)}</Badge> : fmtDate(c.dueAt) ?? "—"}</td>
                  <td className="whitespace-nowrap">{c.returnedAt ? fmtDate(c.returnedAt) : <Badge tone="amber">Out</Badge>}</td>
                  <td className="hidden md:table-cell">{c.checkedOutBy.displayName}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
