import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Paperclip } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getContract, vendorOptions } from "@/server/modules/vendors";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { RenewalBadge, money } from "@/components/renewal-badge";
import { Badge, Card, DL, LinkButton, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { contractFileAction, coverAssetAction, deleteContractAction, removeContractFileAction, saveContractAction, uncoverAssetAction } from "../../actions";
import { ContractForm } from "../../forms";
import { CONTRACT_TYPE } from "../../labels";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.contract.findUnique({ where: { id: (await params).id }, select: { title: true } });
  return { title: c?.title ?? "Contract" };
}

const size = (n: number) => (n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const c = await getContract(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "vendors", "write");
  const crumbs = [{ href: "/vendors?tab=contracts", label: "Contracts" }, { href: `/vendors/${c.vendor.id}`, label: c.vendor.name }];

  if (sp.edit && writable)
    return (
      <>
        <PageHeader crumbs={[...crumbs, { href: `/vendors/contracts/${id}`, label: c.title }]} title="Edit contract" />
        <Card>
          <ContractForm action={saveContractAction.bind(null, id)} values={c} vendors={await vendorOptions()} cancelHref={`/vendors/contracts/${id}`} credential={c.credential} vaultUser={can(ctx.user.role, "vault", "read")} />
        </Card>
        <ActionForm action={deleteContractAction.bind(null, id, c.vendor.id)} className="mt-4 text-right">
          <ConfirmSubmit message={`Delete contract "${c.title}"? It is hidden from lists; the audit log keeps its history.`}>Delete contract</ConfirmSubmit>
        </ActionForm>
      </>
    );

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={c.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <RenewalBadge state={c.state} date={c.state.startsWith("notice") ? c.noticeBy : c.endDate} />
            <span>{CONTRACT_TYPE[c.type]}</span>
            {c.reference && <span className="font-mono">{c.reference}</span>}
            {c.autoRenew && <Badge>auto-renews</Badge>}
          </span>
        }
        actions={writable && <LinkButton href={`/vendors/contracts/${id}?edit=1`} variant="primary">Edit</LinkButton>}
      />

      {c.state === "notice-soon" && c.noticeBy && (
        <p className="mb-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          Notice must be given by <strong>{fmtDate(c.noticeBy)}</strong> ({c.noticeDays} days before the end date) to cancel or renegotiate{c.autoRenew ? ", otherwise it renews automatically" : ""}.
        </p>
      )}
      {c.state === "notice-passed" && (
        <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          The notice deadline ({fmtDate(c.noticeBy)}) has passed.{c.autoRenew ? " This contract will renew automatically." : ""}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title="Terms">
            <DL
              items={[
                ["Vendor", <Link key="v" href={`/vendors/${c.vendor.id}`} className="text-brand hover:underline">{c.vendor.name}</Link>],
                ["Type", CONTRACT_TYPE[c.type]],
                ["Start", fmtDate(c.startDate)],
                ["End", fmtDate(c.endDate) ?? "No end date"],
                ["Notice period", c.noticeDays ? `${c.noticeDays} days (by ${fmtDate(c.noticeBy)})` : null],
                ["Renewal", c.autoRenew ? "Automatic" : "Manual"],
                ["Annual cost", money(c.annualCost)],
                ["SLA / coverage", c.sla],
                ["Internal owner", c.ownerName],
              ]}
            />
            {c.notes && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm">{c.notes}</p>}
          </Card>

          {can(ctx.user.role, "assets", "read") && (
            <Card title={`Covered assets (${c.assets.length})`}>
              {c.assets.length ? (
                <ul className="divide-y divide-line text-sm">
                  {c.assets.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-1.5">
                      <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate text-brand hover:underline"><span className="font-mono">{a.tag}</span> {a.name}</Link>
                      <StatusBadge status={a.status} />
                      {writable && (
                        <ActionForm action={uncoverAssetAction.bind(null, id, a.id)}>
                          <ConfirmSubmit variant="secondary" message={`Remove ${a.tag} from this contract?`}>Remove</ConfirmSubmit>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No assets linked. Link the devices this contract covers so their pages show who supports them.</p>
              )}
              {writable && (
                <ActionForm action={coverAssetAction.bind(null, id)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <Field label="Add a covered asset" name="assetId" className="min-w-64 flex-1"><RemotePicker name="assetId" kind="assets" /></Field>
                  <Submit variant="secondary">Add</Submit>
                </ActionForm>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Getting support">
            <DL
              items={[
                ["Phone", c.vendor.supportPhone],
                ["Email", c.vendor.supportEmail && <a href={`mailto:${c.vendor.supportEmail}`} className="text-brand hover:underline">{c.vendor.supportEmail}</a>],
                ["Portal", c.vendor.supportUrl && <a href={c.vendor.supportUrl} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{c.vendor.supportUrl}</a>],
                [
                  "Portal login",
                  c.credential ? (
                    <Link href={`/vault/${c.credential.id}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Lock className="h-3.5 w-3.5" />{c.credential.title}</Link>
                  ) : c.hasCredential ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted"><Lock className="h-3.5 w-3.5" />In the vault (no access)</span>
                  ) : null,
                ],
                ["Contract number", c.reference && <span className="font-mono">{c.reference}</span>],
              ]}
            />
          </Card>

          {c.licenses.length > 0 && can(ctx.user.role, "software", "read") && (
            <Card title="Licences under this contract">
              <ul className="space-y-1 text-sm">
                {c.licenses.map((l) => <li key={l.id}><Link href={`/software/licenses/${l.id}`} className="text-brand hover:underline">{l.software.name} — {l.name}</Link></li>)}
              </ul>
            </Card>
          )}

          <Card title={`Documents (${c.attachments.length})`}>
            {c.attachments.length ? (
              <ul className="space-y-1.5 text-sm">
                {c.attachments.map((f) => (
                  <li key={f.id} className="flex items-start gap-2">
                    <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <a href={`/api/files/${f.id}`} className="break-all text-brand hover:underline">{f.fileName}</a>
                      <span className="block text-xs text-muted">{size(f.size)} · {f.uploadedBy}</span>
                    </span>
                    {writable && (
                      <ActionForm action={removeContractFileAction.bind(null, f.id)}>
                        <ConfirmSubmit message={`Remove ${f.fileName}?`}>✕</ConfirmSubmit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No documents. Attach the signed agreement, quote or renewal notice.</p>
            )}
            {writable && (
              <ActionForm action={contractFileAction.bind(null, id)} className="mt-3 space-y-2 border-t border-line pt-3" resetOnSuccess>
                <Field label="Attach a document" name="file" hint="Up to 10 MB">
                  <input id="file" name="file" type="file" className="block w-full text-xs file:mr-2 file:rounded file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-xs" />
                </Field>
                <Submit variant="secondary">Upload</Submit>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
