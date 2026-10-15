import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { getCredential } from "@/server/modules/vault";
import { entityHistory } from "@/server/modules/audit-query";
import { NotFoundError } from "@/server/lib/errors";
import { Badge, Card, DL, LinkButton, PageHeader, fmtDate, fmtDateTime } from "@/components/ui";
import { SecretField } from "../secret-field";
import { TotpCode } from "./totp-code";
import { AssetLinks, DeleteCredential } from "./forms";

// Static title: credential titles stay out of browser history / tab titles
export const metadata = { title: "Credential" };

export default async function CredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const c = await getCredential(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const log = await entityHistory("Credential", id, 30);
  const editable = c.myAccess === "edit";
  const due = c.rotationDueAt ? Math.round((c.rotationDueAt.getTime() - Date.now()) / 86_400_000) : null;
  const httpUrl = c.url && /^https?:\/\//i.test(c.url);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/vault", label: "Vault" }, { href: `/vault?folderId=${c.folder.id}`, label: c.folder.name }]}
        title={c.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.folder.restricted && (
              <Badge tone="amber">
                <Lock className="mr-1 h-3 w-3" /> restricted folder
              </Badge>
            )}
            {due !== null && due < 0 && <Badge tone="red">Rotation {-due}d overdue</Badge>}
            {due !== null && due >= 0 && due <= 14 && <Badge tone="amber">Rotation due in {due}d</Badge>}
            {!editable && <Badge>view only</Badge>}
          </span>
        }
        actions={editable && <LinkButton href={`/vault/${id}/edit`} variant="primary">Edit</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Sign-in">
            <div className="space-y-4">
              <DL
                items={[
                  ["Username", c.username && <span className="font-mono">{c.username}</span>],
                  ["URL / host", c.url && (httpUrl ? <a className="text-brand hover:underline" href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a> : <span className="font-mono">{c.url}</span>)],
                ]}
              />
              <div>
                <p className="mb-1 text-xs text-muted">Password</p>
                <SecretField credentialId={id} what={{ field: "password" }} />
              </div>
              {c.hasTotp && (
                <div>
                  <p className="mb-1 text-xs text-muted">TOTP code</p>
                  <TotpCode credentialId={id} />
                </div>
              )}
            </div>
          </Card>
          {c.notes && (
            <Card title="Notes">
              <p className="whitespace-pre-wrap text-sm">{c.notes}</p>
            </Card>
          )}
          <Card title={`Password history (${c.history.length})`}>
            {c.history.length ? (
              <ul className="space-y-3">
                {c.history.map((h) => (
                  <li key={h.id}>
                    <p className="mb-1 text-xs text-muted">Replaced {fmtDateTime(h.replacedAt)} by {h.replacedBy}</p>
                    <SecretField credentialId={id} what={{ field: "history", historyId: h.id }} label="previous password" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">The password has not been changed since it was saved.</p>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Details">
            <DL
              items={[
                ["Folder", <Link key="f" className="text-brand hover:underline" href={`/vault/folders/${c.folder.id}`}>{c.folder.name}</Link>],
                ["Password changed", fmtDate(c.passwordChangedAt)],
                ["Rotation", c.rotateEveryDays ? `every ${c.rotateEveryDays} days (next ${fmtDate(c.rotationDueAt)})` : "not scheduled"],
                ["Created by", `${c.createdBy}, ${fmtDate(c.createdAt)}`],
              ]}
            />
          </Card>
          <Card title="Used on assets">
            <AssetLinks credentialId={id} assets={c.assets} editable={editable} />
          </Card>
          <Card title="Access log">
            <ul className="max-h-96 space-y-2 overflow-auto text-sm">
              {log.map((h) => (
                <li key={String(h.id)}>
                  <p className={h.action === "view_sensitive" ? "text-warn" : undefined}>{h.summary}</p>
                  <p className="text-xs text-muted">{fmtDateTime(h.at)} · {h.actorName}{h.ip ? ` · ${h.ip}` : ""}</p>
                </li>
              ))}
            </ul>
          </Card>
          {editable && <DeleteCredential credentialId={id} />}
        </div>
      </div>
    </>
  );
}
