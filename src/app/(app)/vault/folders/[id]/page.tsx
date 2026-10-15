import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can, ROLE_LABELS } from "@/server/rbac/permissions";
import { getFolder, listCredentials } from "@/server/modules/vault";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, fmtDate } from "@/components/ui";
import { DeleteFolder, FolderForm, GrantForm, RevokeGrant } from "../folder-forms";
import { saveFolderAction } from "../../actions";

export const metadata = { title: "Vault folder" };

export default async function FolderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { edit } = await searchParams;
  const f = await getFolder(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const isAdmin = ctx.user.role === "ADMIN";

  if (edit && isAdmin) {
    return (
      <>
        <PageHeader title={`Edit ${f.name}`} crumbs={[{ href: "/vault", label: "Vault" }, { href: `/vault/folders/${id}`, label: f.name }]} />
        <FolderForm action={saveFolderAction.bind(null, id)} values={f} cancelHref={`/vault/folders/${id}`} />
      </>
    );
  }

  const [creds, users] = await Promise.all([
    listCredentials(ctx, { folderId: id }),
    isAdmin
      ? db.user.findMany({ where: { active: true, role: { in: ["ADMIN", "TECHNICIAN"] } }, select: { id: true, displayName: true, role: true }, orderBy: { displayName: "asc" } })
      : [],
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/vault", label: "Vault" }]}
        title={f.name}
        subtitle={
          <span className="flex items-center gap-2">
            {f.restricted ? <Badge tone="amber">restricted</Badge> : <Badge>open to all technicians</Badge>}
            <span>Your access: {f.myAccess}</span>
          </span>
        }
        actions={
          <>
            {isAdmin && <LinkButton href={`/vault/folders/${id}?edit=1`}>Edit folder</LinkButton>}
            {f.myAccess === "edit" && can(ctx.user.role, "vault", "write") && <LinkButton href={`/vault/new?folderId=${id}`} variant="primary">New credential</LinkButton>}
          </>
        }
      />
      {f.description && <p className="mb-4 text-sm text-muted">{f.description}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          {creds.length === 0 ? (
            <Empty title="Empty folder" />
          ) : (
            <Table>
              <thead><tr><th>Title</th><th>Username</th><th>Changed</th></tr></thead>
              <tbody>
                {creds.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/vault/${c.id}`} className="text-brand hover:underline">{c.title}</Link></td>
                    <td className="font-mono text-xs">{c.username}</td>
                    <td>{fmtDate(c.passwordChangedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        {isAdmin && (
          <div className="space-y-4">
            <Card title="Access">
              {!f.restricted ? (
                <p className="text-sm text-muted">
                  This folder is not restricted: every administrator and technician can view and edit it. Mark it restricted (Edit folder) to limit access to the grants below.
                </p>
              ) : (
                <p className="mb-3 text-sm text-muted">Administrators always have access. Everyone else needs a grant.</p>
              )}
              {f.grants.length > 0 && (
                <ul className="my-3 divide-y divide-line text-sm">
                  {f.grants.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span>{g.user ? g.user.displayName : `All ${ROLE_LABELS[g.role!].toLowerCase()}s`}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={g.level === "EDIT" ? "blue" : "gray"}>{g.level.toLowerCase()}</Badge>
                        <RevokeGrant grantId={g.id} folderId={id} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <GrantForm folderId={id} users={users.filter((u) => u.role !== "ADMIN")} />
            </Card>
            <DeleteFolder folderId={id} />
          </div>
        )}
      </div>
    </>
  );
}
