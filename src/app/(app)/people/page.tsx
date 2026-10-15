import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listDepartments, listPeople } from "@/server/modules/people";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Pagination, Select, Table } from "@/components/ui";
import { DepartmentForm } from "./department-form";

export const metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; departmentId?: string; page?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "people", "read");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total }, departments] = await Promise.all([
    listPeople({ q: sp.q, departmentId: sp.departmentId, take: 50, skip: (page - 1) * 50 }),
    listDepartments(),
  ]);
  const writable = can(ctx.user.role, "people", "write");

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Staff that devices can be assigned or loaned to. Directory sync arrives in phase 9."
        actions={writable && <LinkButton href="/people/new" variant="primary">Add person</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div>
          <form className="mb-4 flex flex-wrap gap-2 rounded-lg border border-line bg-surface p-3">
            <Input name="q" defaultValue={sp.q} placeholder="Name, email, employee ID…" className="min-w-48 flex-1" aria-label="Search" />
            <Select name="departmentId" defaultValue={sp.departmentId ?? ""} className="w-56" aria-label="Department">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Button type="submit">Filter</Button>
          </form>
          {rows.length === 0 ? (
            <Empty title="No people found" />
          ) : (
            <Table>
              <thead>
                <tr><th>Name</th><th className="hidden md:table-cell">Email</th><th>Department</th><th>Assets</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/people/${p.id}`} className="text-brand hover:underline">{p.name}</Link>
                      {!p.active && <Badge className="ml-1.5">inactive</Badge>}
                    </td>
                    <td className="hidden md:table-cell">{p.email}</td>
                    <td>{p.department?.name}</td>
                    <td className="tabular-nums">{p._count.assets}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={page} pageSize={50} total={total} href={(n) => `/people?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.departmentId ? { departmentId: sp.departmentId } : {}), page: String(n) })}`} />
        </div>
        <Card title="Departments">
          <ul className="mb-4 space-y-1 text-sm">
            {departments.map((d) => (
              <li key={d.id}>
                <Link className="hover:underline" href={`/people?departmentId=${d.id}`}>{d.name}</Link>
                {d.costCenter && <span className="ml-1 text-xs text-muted">({d.costCenter})</span>}
              </li>
            ))}
          </ul>
          {writable && <DepartmentForm />}
        </Card>
      </div>
    </>
  );
}
