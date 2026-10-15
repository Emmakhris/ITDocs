import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { getPerson, listDepartments } from "@/server/modules/people";
import { NotFoundError } from "@/server/lib/errors";
import { Badge, Card, DL, LinkButton, PageHeader, StatusBadge, Table, fmtDate } from "@/components/ui";
import { PersonForm } from "../person-form";
import { SeatsCard } from "@/components/seats-card";
import { seatsFor } from "@/server/modules/software";
import { savePersonAction } from "../actions";

export default async function PersonDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "people", "read");
  const { id } = await params;
  const { edit } = await searchParams;
  const p = await getPerson(id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "people", "write");

  if (edit && writable) {
    const departments = (await listDepartments()).map((d) => ({ id: d.id, name: d.name }));
    return (
      <>
        <PageHeader title={`Edit ${p.name}`} crumbs={[{ href: "/people", label: "People" }, { href: `/people/${id}`, label: p.name }]} />
        <PersonForm
          action={savePersonAction.bind(null, id)}
          values={{ name: p.name, email: p.email, employeeId: p.employeeId, phone: p.phone, title: p.title, departmentId: p.departmentId, active: p.active }}
          departments={departments}
          cancelHref={`/people/${id}`}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/people", label: "People" }]}
        title={p.name}
        subtitle={[p.title, p.department?.name].filter(Boolean).join(" · ")}
        actions={writable && <LinkButton href={`/people/${id}?edit=1`} variant="primary">Edit</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Assigned assets (${p.assets.length})`}>
            {p.assets.length ? (
              <Table>
                <thead><tr><th>Tag</th><th>Name</th><th>Type</th><th>Status</th><th>Location</th></tr></thead>
                <tbody>
                  {p.assets.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs"><Link className="text-brand hover:underline" href={`/assets/${a.id}`}>{a.tag}</Link></td>
                      <td>{a.name}</td>
                      <td>{a.type.name}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td>{a.location?.name}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No assets assigned.</p>
            )}
          </Card>
          <Card title="Loans">
            {p.checkouts.length ? (
              <ul className="divide-y divide-line text-sm">
                {p.checkouts.map((c) => (
                  <li key={c.id} className="flex justify-between gap-2 py-1.5">
                    <Link className="hover:underline" href={`/assets/${c.asset.id}`}>{c.asset.tag} · {c.asset.name}</Link>
                    <span className="text-xs text-muted">
                      {fmtDate(c.outAt)} → {c.returnedAt ? fmtDate(c.returnedAt) : <Badge tone="amber">out</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No loans.</p>
            )}
          </Card>
        </div>
        <div className="space-y-4">
        <Card title="Contact">
          <DL
            items={[
              ["Email", p.email && <a className="text-brand hover:underline" href={`mailto:${p.email}`}>{p.email}</a>],
              ["Phone", p.phone],
              ["Employee ID", p.employeeId],
              ["Status", p.active ? "Active" : "Inactive"],
            ]}
          />
        </Card>
        {can(ctx.user.role, "software", "read") && <SeatsCard seats={await seatsFor(ctx, { personId: id })} emptyText="No software licences assigned." />}
        </div>
      </div>
    </>
  );
}
