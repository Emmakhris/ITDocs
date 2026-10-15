import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getLicense, softwareOptions } from "@/server/modules/software";
import { vendorOptions } from "@/server/modules/vendors";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { RenewalBadge, money } from "@/components/renewal-badge";
import { Badge, Card, DL, Input, LinkButton, PageHeader, Table, cx, fmtDate } from "@/components/ui";
import { assignSeatAction, deleteLicenseAction, saveLicenseAction, unassignSeatAction } from "../../actions";
import { LicenseForm } from "../../forms";
import { LICENSE_MODEL, SEAT_BASIS } from "../../labels";
import { LicenseKeyField } from "../../key-field";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const l = await db.license.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: l?.name ?? "Licence" };
}

export default async function LicensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; over?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const l = await getLicense(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "software", "write");
  const crumbs = [{ href: "/software", label: "Software" }, { href: `/software/${l.software.id}`, label: l.software.name }];

  if (writable && sp.edit) {
    const [vendors, software, contracts] = await Promise.all([vendorOptions(), softwareOptions(), db.contract.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } })]);
    return (
      <>
        <PageHeader crumbs={[...crumbs, { href: `/software/licenses/${id}`, label: l.name }]} title="Edit licence" />
        <Card><LicenseForm action={saveLicenseAction.bind(null, id)} values={l} software={software} vendors={vendors} contracts={contracts} cancelHref={`/software/licenses/${id}`} editing /></Card>
        <ActionForm action={deleteLicenseAction.bind(null, id, l.software.id)} className="mt-4 text-right">
          <ConfirmSubmit message={`Delete licence "${l.name}"? It is hidden from lists; the audit log keeps its history.`}>Delete licence</ConfirmSubmit>
        </ActionForm>
      </>
    );
  }

  const pct = l.usage.seats ? Math.min(100, Math.round((l.usage.used / l.usage.seats) * 100)) : 0;
  const needs = l.seatBasis === "DEVICE" ? "device" : l.seatBasis === "USER" ? "person" : "either";

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={l.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{LICENSE_MODEL[l.model]} · per {SEAT_BASIS[l.seatBasis].toLowerCase()}</span>
            {l.state !== "active" && l.state !== "open" && <RenewalBadge state={l.state} date={l.expiresAt} />}
            {l.usage.over > 0 && <Badge tone="red">Over-allocated by {l.usage.over}</Badge>}
          </span>
        }
        actions={writable && <LinkButton href={`/software/licenses/${id}?edit=1`} variant="primary">Edit</LinkButton>}
      />

      {sp.over && Number(sp.over) > 0 && (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          Seat assigned, but this licence is now over-allocated by {sp.over}. Buy more seats or release unused ones before a vendor audit.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card
            title={`Seats in use (${l.usage.used}${l.usage.seats ? ` of ${l.usage.seats}` : ""})`}
            actions={l.stale > 0 && <Badge tone="amber">{l.stale} can probably be reclaimed</Badge>}
          >
            {l.usage.seats !== null && (
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={l.usage.used} aria-valuemin={0} aria-valuemax={l.usage.seats} aria-label="Seats used">
                <div className={cx("h-full rounded-full", l.usage.over ? "bg-danger" : pct >= 90 ? "bg-warn" : "bg-brand")} style={{ width: `${pct}%` }} />
              </div>
            )}
            {l.assignments.length ? (
              <Table className="border-0">
                <thead><tr><th>Assigned to</th><th>Since</th><th>By</th><th>Notes</th>{writable && <th />}</tr></thead>
                <tbody>
                  {l.assignments.map((a) => {
                    const stale = (a.asset && (a.asset.deletedAt || ["RETIRED", "DISPOSED", "LOST"].includes(a.asset.status))) || (a.person && (!a.person.active || a.person.deletedAt));
                    return (
                      <tr key={a.id} className={stale ? "bg-warn-soft/50" : undefined}>
                        <td>
                          {a.asset ? (
                            <Link href={`/assets/${a.asset.id}`} className="text-brand hover:underline"><span className="font-mono">{a.asset.tag}</span> {a.asset.name}</Link>
                          ) : a.person ? (
                            <Link href={`/people/${a.person.id}`} className="text-brand hover:underline">{a.person.name}</Link>
                          ) : null}
                          {stale && <span className="block text-xs text-warn">{a.asset ? `Device is ${a.asset.deletedAt ? "deleted" : a.asset.status.toLowerCase()}` : "Person has left"}</span>}
                        </td>
                        <td className="whitespace-nowrap">{fmtDate(a.assignedAt)}</td>
                        <td>{a.assignedBy}</td>
                        <td className="text-muted">{a.notes}</td>
                        {writable && (
                          <td className="text-right">
                            <ActionForm action={unassignSeatAction.bind(null, a.id)}>
                              <ConfirmSubmit variant="secondary" message="Release this seat?">Release</ConfirmSubmit>
                            </ActionForm>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No seats assigned yet.</p>
            )}
            {writable && (
              <ActionForm action={assignSeatAction.bind(null, id)} className="mt-4 space-y-3 border-t border-line pt-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  {needs !== "person" && <Field label="Device" name="assetId"><RemotePicker name="assetId" kind="assets" /></Field>}
                  {needs !== "device" && <Field label="Person" name="personId"><RemotePicker name="personId" kind="people" /></Field>}
                  <Field label="Notes" name="notes"><Input id="seat-notes" name="notes" placeholder="Optional" /></Field>
                </div>
                {needs === "either" && <p className="text-xs text-muted">Choose a device or a person, not both.</p>}
                <Submit variant="secondary">Assign seat</Submit>
              </ActionForm>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {writable ? (
            <Card title="Licence key">{l.hasKey ? <LicenseKeyField licenseId={id} /> : <p className="text-sm text-muted">No key stored. Add one with Edit.</p>}</Card>
          ) : (
            l.hasKey && <Card title="Licence key"><p className="text-sm text-muted">A key is stored. Technicians and admins can reveal it.</p></Card>
          )}
          <Card title="Details">
            <DL
              items={[
                ["Seats", l.usage.seats ?? "Unlimited (site)"],
                ["Expires / renews", fmtDate(l.expiresAt)],
                ["Bought from", l.vendor && <Link href={`/vendors/${l.vendor.id}`} className="text-brand hover:underline">{l.vendor.name}</Link>],
                ["Contract", l.contract && !l.contract.deletedAt && <Link href={`/vendors/contracts/${l.contract.id}`} className="text-brand hover:underline">{l.contract.title}</Link>],
                ["PO number", l.poNumber && <span className="font-mono">{l.poNumber}</span>],
                ["Purchased", fmtDate(l.purchaseDate)],
                ["Cost", money(l.cost)],
              ]}
            />
            {l.notes && <p className="mt-3 whitespace-pre-wrap border-t border-line pt-3 text-sm">{l.notes}</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
