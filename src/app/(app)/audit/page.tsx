import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { auditFacets, queryAudit, type AuditFilter } from "@/server/modules/audit-query";
import { Badge, Button, Input, LinkButton, PageHeader, Pagination, Select, Table, fmtDateTime } from "@/components/ui";
import { AuditDetail } from "./audit-detail";

export const metadata = { title: "Audit log" };

type SP = { q?: string; action?: string; entityType?: string; actor?: string; from?: string; to?: string; page?: string; entityId?: string };

function auditFilterFrom(sp: SP): AuditFilter {
  const d = (s?: string, end = false) => (s ? new Date(s + (end ? "T23:59:59.999" : "T00:00:00")) : undefined);
  return { q: sp.q, action: sp.action, entityType: sp.entityType, entityId: sp.entityId, actor: sp.actor, from: d(sp.from), to: d(sp.to, true), page: Number(sp.page) || 1 };
}

const TONE: Record<string, "red" | "amber" | "green" | "blue" | "gray"> = {
  login_failed: "red", delete: "red", dispose: "red", view_sensitive: "amber", export: "amber",
  create: "green", login: "blue", move: "blue", checkout: "amber", checkin: "blue",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "audit", "read");
  const sp = await searchParams;
  const [{ rows, total, page, pageSize }, facets] = await Promise.all([queryAudit(ctx, auditFilterFrom(sp)), auditFacets()]);
  const params = (patch: Partial<SP>) =>
    new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of sign-ins, changes, sensitive views and exports. Entries cannot be altered or deleted, even by administrators."
        actions={<LinkButton href={`/api/audit/export?${params({ page: undefined })}`} prefetch={false}>Export CSV</LinkButton>}
      />
      <form className="mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-3 lg:grid-cols-[1fr_150px_150px_150px_140px_140px_auto]">
        <Input name="q" defaultValue={sp.q} placeholder="Search summary…" aria-label="Search" />
        <Select name="action" defaultValue={sp.action ?? ""} aria-label="Action">
          <option value="">Any action</option>
          {facets.actions.map((a) => <option key={a}>{a}</option>)}
        </Select>
        <Select name="entityType" defaultValue={sp.entityType ?? ""} aria-label="Record type">
          <option value="">Any record</option>
          {facets.entityTypes.map((a) => <option key={a}>{a}</option>)}
        </Select>
        <Input name="actor" defaultValue={sp.actor} placeholder="User" aria-label="User" />
        <Input type="date" name="from" defaultValue={sp.from} aria-label="From" />
        <Input type="date" name="to" defaultValue={sp.to} aria-label="To" />
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <LinkButton href="/audit" variant="ghost">Reset</LinkButton>
        </div>
      </form>
      <Table>
        <thead>
          <tr><th className="w-44">When</th><th>User</th><th>Action</th><th>Record</th><th>Summary</th><th className="hidden xl:table-cell">IP</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(r.at)}</td>
              <td className="whitespace-nowrap">{r.actorName}</td>
              <td><Badge tone={TONE[r.action] ?? "gray"}>{r.action}</Badge></td>
              <td className="whitespace-nowrap text-xs text-muted">{r.entityType}</td>
              <td>
                {r.summary}
                {(r.before || r.after) && <AuditDetail before={r.before} after={r.after} />}
              </td>
              <td className="hidden font-mono text-xs xl:table-cell">{r.ip}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} pageSize={pageSize} total={total} href={(p) => `/audit?${params({ page: String(p) })}`} />
    </>
  );
}
