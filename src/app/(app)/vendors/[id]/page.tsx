import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getVendor } from "@/server/modules/vendors";
import { contractState } from "@/server/lib/renewals";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RenewalBadge, money } from "@/components/renewal-badge";
import { Card, DL, Input, LinkButton, PageHeader, Table, fmtDate } from "@/components/ui";
import { deleteContactAction, deleteVendorAction, saveContactAction, saveVendorAction } from "../actions";
import { VendorForm } from "../forms";
import { CONTRACT_TYPE } from "../labels";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const v = await db.vendor.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: v?.name ?? "Vendor" };
}

const ext = (url: string | null) => url && <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{url}</a>;

export default async function VendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; contact?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const v = await getVendor(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "vendors", "write");
  const editingContact = sp.contact && writable ? (sp.contact === "new" ? null : v.contacts.find((c) => c.id === sp.contact)) : undefined;

  if (sp.edit && writable)
    return (
      <>
        <PageHeader crumbs={[{ href: "/vendors", label: "Vendors" }, { href: `/vendors/${id}`, label: v.name }]} title={`Edit ${v.name}`} />
        <Card><VendorForm action={saveVendorAction.bind(null, id)} values={v} cancelHref={`/vendors/${id}`} /></Card>
        <ActionForm action={deleteVendorAction.bind(null, id)} className="mt-4 text-right">
          <ConfirmSubmit message={`Delete vendor ${v.name}? Only possible once it has no contracts, software or licences.`}>Delete vendor</ConfirmSubmit>
        </ActionForm>
      </>
    );

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/vendors", label: "Vendors" }]}
        title={v.name}
        subtitle={v.accountNumber ? `Account ${v.accountNumber}` : undefined}
        actions={
          writable && (
            <>
              <LinkButton href={`/vendors/contracts/new?vendorId=${id}`}>New contract</LinkButton>
              <LinkButton href={`/vendors/${id}?edit=1`} variant="primary">Edit</LinkButton>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card title={`Contracts (${v.contracts.length})`}>
            {v.contracts.length ? (
              <Table className="border-0">
                <thead><tr><th>Contract</th><th>Type</th><th>Ends</th><th>Status</th><th className="text-right">Annual cost</th></tr></thead>
                <tbody>
                  {v.contracts.map((c) => {
                    const st = contractState(c);
                    return (
                      <tr key={c.id}>
                        <td><Link href={`/vendors/contracts/${c.id}`} className="text-brand hover:underline">{c.title}</Link></td>
                        <td>{CONTRACT_TYPE[c.type]}</td>
                        <td className="whitespace-nowrap">{fmtDate(c.endDate) || "—"}</td>
                        <td><RenewalBadge state={st.state} date={st.noticeBy} /></td>
                        <td className="text-right tabular-nums">{money(c.annualCost?.toString())}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No contracts with this vendor.</p>
            )}
          </Card>

          <Card title={`Contacts (${v.contacts.length})`} actions={writable && editingContact === undefined && <Link href={`/vendors/${id}?contact=new`} className="text-xs text-brand hover:underline" scroll={false}>Add contact</Link>}>
            {editingContact !== undefined && (
              <ActionForm key={editingContact?.id ?? "new"} action={saveContactAction.bind(null, id, editingContact?.id ?? null)} className="mb-4 space-y-3 rounded-md border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name" name="name" required><Input id="name" name="name" defaultValue={editingContact?.name ?? ""} /></Field>
                  <Field label="Role" name="role"><Input id="role" name="role" defaultValue={editingContact?.role ?? ""} placeholder="Account manager, escalation…" /></Field>
                  <Field label="Email" name="email"><Input id="email" name="email" type="email" defaultValue={editingContact?.email ?? ""} /></Field>
                  <Field label="Phone" name="phone"><Input id="phone" name="phone" defaultValue={editingContact?.phone ?? ""} /></Field>
                  <Field label="Notes" name="notes" className="sm:col-span-2"><Input id="notes" name="notes" defaultValue={editingContact?.notes ?? ""} /></Field>
                </div>
                <div className="flex gap-2"><Submit>Save contact</Submit><LinkButton href={`/vendors/${id}`} scroll={false}>Cancel</LinkButton></div>
              </ActionForm>
            )}
            {v.contacts.length ? (
              <ul className="divide-y divide-line text-sm">
                {v.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2">
                    <div className="min-w-40 flex-1">
                      <p className="font-medium">{c.name}</p>
                      {c.role && <p className="text-xs text-muted">{c.role}</p>}
                    </div>
                    <div className="min-w-40 flex-1 text-xs">
                      {c.email && <a href={`mailto:${c.email}`} className="block text-brand hover:underline">{c.email}</a>}
                      {c.phone && <span className="block">{c.phone}</span>}
                      {c.notes && <span className="block text-muted">{c.notes}</span>}
                    </div>
                    {writable && (
                      <div className="flex items-center gap-2">
                        <Link href={`/vendors/${id}?contact=${c.id}`} className="text-xs text-brand hover:underline" scroll={false}>Edit</Link>
                        <ActionForm action={deleteContactAction.bind(null, id, c.id)}>
                          <ConfirmSubmit variant="secondary" message={`Remove contact ${c.name}?`}>Remove</ConfirmSubmit>
                        </ActionForm>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              editingContact === undefined && <p className="text-sm text-muted">No contacts yet.</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Support">
            <DL
              items={[
                ["Support phone", v.supportPhone && <a href={`tel:${v.supportPhone.replace(/[^\d+]/g, "")}`} className="text-brand hover:underline">{v.supportPhone}</a>],
                ["Support email", v.supportEmail && <a href={`mailto:${v.supportEmail}`} className="text-brand hover:underline">{v.supportEmail}</a>],
                ["Support portal", ext(v.supportUrl)],
              ]}
            />
          </Card>
          <Card title="Company">
            <DL items={[["Website", ext(v.website)], ["Phone", v.phone], ["Email", v.email], ["Account number", v.accountNumber && <span className="font-mono">{v.accountNumber}</span>]]} />
            {v.notes && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm">{v.notes}</p>}
          </Card>
          {can(ctx.user.role, "software", "read") && (
            <Card title="Software">
              {v.software.length ? (
                <ul className="space-y-1 text-sm">
                  {v.software.map((s) => (
                    <li key={s.id}><Link href={`/software/${s.id}`} className="text-brand hover:underline">{s.name}</Link>{s.category && <span className="ml-1 text-xs text-muted">{s.category}</span>}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No software from this vendor.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
