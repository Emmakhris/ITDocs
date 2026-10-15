import Link from "next/link";
import { Lock } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listCredentials, listFolders } from "@/server/modules/vault";
import { vaultConfigured } from "@/server/crypto/vault";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Table, cx, fmtDate } from "@/components/ui";

export const metadata = { title: "Password vault" };

export default async function VaultPage({ searchParams }: { searchParams: Promise<{ q?: string; folderId?: string; due?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "vault", "read");
  const sp = await searchParams;
  const [folders, creds] = await Promise.all([listFolders(ctx), listCredentials(ctx, { q: sp.q, folderId: sp.folderId, due: sp.due === "1" })]);
  const isAdmin = ctx.user.role === "ADMIN";
  const canWrite = can(ctx.user.role, "vault", "write") && folders.some((f) => f.myAccess === "edit");
  const now = Date.now();
  const current = folders.find((f) => f.id === sp.folderId);

  return (
    <>
      <PageHeader
        title="Password vault"
        subtitle="Encrypted with AES-256-GCM. Every reveal and copy is recorded in the audit log."
        actions={
          <>
            {isAdmin && <LinkButton href="/vault/folders/new">New folder</LinkButton>}
            {canWrite && <LinkButton href={`/vault/new${sp.folderId ? `?folderId=${sp.folderId}` : ""}`} variant="primary">New credential</LinkButton>}
          </>
        }
      />
      {!vaultConfigured() && (
        <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          VAULT_MASTER_KEY is missing or invalid on the server — credentials cannot be saved or revealed. See README › Password vault.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card title="Folders">
          <ul className="space-y-0.5 text-sm">
            <li>
              <Link href="/vault" className={cx("flex justify-between rounded px-2 py-1 hover:bg-surface-2", !sp.folderId && "bg-surface-2 font-medium")}>
                All folders <span className="text-muted">{folders.reduce((s, f) => s + f.count, 0)}</span>
              </Link>
            </li>
            {folders.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/vault?folderId=${f.id}`}
                  className={cx("flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-surface-2", sp.folderId === f.id && "bg-surface-2 font-medium")}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {f.restricted && <Lock className="h-3.5 w-3.5 shrink-0 text-warn" aria-label="Restricted" />}
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="text-muted">{f.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          {folders.length === 0 && <p className="text-sm text-muted">{isAdmin ? "Create a folder to start." : "No folders shared with you."}</p>}
          {current && (
            <Link href={`/vault/folders/${current.id}`} className="mt-3 block text-xs text-brand hover:underline">
              Folder details{isAdmin ? " & access" : ""} →
            </Link>
          )}
        </Card>

        <div>
          <form className="mb-3 flex flex-wrap gap-2 rounded-lg border border-line bg-surface p-3">
            {sp.folderId && <input type="hidden" name="folderId" value={sp.folderId} />}
            <Input name="q" defaultValue={sp.q} placeholder="Search title, username, URL, notes…" className="min-w-48 flex-1" aria-label="Search credentials" />
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="due" value="1" defaultChecked={sp.due === "1"} /> Rotation due (14 days)
            </label>
            <Button type="submit">Search</Button>
          </form>
          {creds.length === 0 ? (
            <Empty title="No credentials">{canWrite ? "Add one with “New credential”." : undefined}</Empty>
          ) : (
            <Table>
              <thead>
                <tr><th>Title</th><th>Username</th><th className="hidden md:table-cell">Folder</th><th className="hidden lg:table-cell">Changed</th><th>Rotation</th></tr>
              </thead>
              <tbody>
                {creds.map((c) => {
                  const due = c.rotationDueAt ? Math.round((c.rotationDueAt.getTime() - now) / 86_400_000) : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/vault/${c.id}`} className="text-brand hover:underline">{c.title}</Link>
                        {c.hasTotp && <Badge className="ml-1.5">2FA</Badge>}
                        {c.url && <span className="block truncate text-xs text-muted">{c.url}</span>}
                      </td>
                      <td className="font-mono text-xs">{c.username}</td>
                      <td className="hidden md:table-cell">{c.folder.name}</td>
                      <td className="hidden whitespace-nowrap lg:table-cell">{fmtDate(c.passwordChangedAt)}</td>
                      <td className="whitespace-nowrap">
                        {due === null ? <span className="text-muted">—</span> : due < 0 ? <Badge tone="red">{-due}d overdue</Badge> : due <= 14 ? <Badge tone="amber">due in {due}d</Badge> : fmtDate(c.rotationDueAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </>
  );
}
