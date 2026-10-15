import { requireCtx } from "@/server/auth/session";
import { assertCan, ROLE_LABELS } from "@/server/rbac/permissions";
import { listGroupMappings, listUsers } from "@/server/modules/users";
import { Badge, Card, PageHeader, Table, fmtDateTime } from "@/components/ui";
import { AdminNav } from "../admin-nav";
import { UserRow, MappingForm, MappingDelete, BreakGlassForm } from "./forms";

export const metadata = { title: "Users & directory" };

export default async function UsersPage() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "admin", "read");
  const [users, mappings] = await Promise.all([listUsers(ctx), listGroupMappings()]);
  const ldap = {
    enabled: process.env.LDAP_ENABLED === "true",
    url: process.env.LDAP_URL,
    base: process.env.LDAP_BASE_DN,
  };

  return (
    <>
      <PageHeader title="Administration" />
      <AdminNav current="/admin/users" />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="Users">
          <p className="mb-3 text-sm text-muted">
            Directory users are created on first sign-in; their role is re-calculated from AD groups at every sign-in, so change roles via group mappings. Disabling a user here blocks access immediately.
          </p>
          <Table>
            <thead><tr><th>User</th><th>Source</th><th>Last sign-in</th><th className="w-[300px]">Role / access</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="font-medium">{u.displayName}</span>
                    <span className="block font-mono text-xs text-muted">{u.username}</span>
                  </td>
                  <td>
                    <Badge tone={u.source === "LOCAL" ? "amber" : "blue"}>{u.source === "LOCAL" ? "break-glass" : "AD"}</Badge>
                    {u.source === "LOCAL" && !u.totpEnabled && <Badge tone="red" className="ml-1">no MFA</Badge>}
                  </td>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(u.lastLoginAt) ?? "never"}</td>
                  <td><UserRow id={u.id} role={u.role} active={u.active} self={u.id === ctx.user.id} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-4">
          <Card title="Active Directory">
            <dl className="space-y-1 text-sm">
              <div><dt className="inline text-muted">Status: </dt><dd className="inline">{ldap.enabled ? <Badge tone="green">enabled</Badge> : <Badge>disabled</Badge>}</dd></div>
              <div><dt className="inline text-muted">Server: </dt><dd className="inline font-mono text-xs">{ldap.url ?? "—"}</dd></div>
              <div><dt className="inline text-muted">Base DN: </dt><dd className="inline font-mono text-xs">{ldap.base ?? "—"}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Connection settings live in the server&apos;s <code>.env</code> file (see README).</p>
          </Card>
          <Card title="AD group → role mappings">
            <p className="mb-3 text-xs text-muted">Group names match the CN (e.g. <code>IT-Technicians</code>). When a user is in several groups, the highest priority wins. Users in no mapped group cannot sign in.</p>
            <ul className="mb-4 divide-y divide-line text-sm">
              {mappings.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate font-mono text-xs">{m.groupName}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="blue">{ROLE_LABELS[m.role]}</Badge>
                    <span className="text-xs text-muted">p{m.priority}</span>
                    <MappingDelete id={m.id} />
                  </span>
                </li>
              ))}
            </ul>
            <MappingForm />
          </Card>
          <Card title="Break-glass accounts">
            <p className="mb-3 text-xs text-muted">Local administrator accounts for when AD is unreachable. Keep to one or two, store the password in a sealed envelope / safe, and enrol MFA.</p>
            <BreakGlassForm />
          </Card>
        </div>
      </div>
    </>
  );
}
