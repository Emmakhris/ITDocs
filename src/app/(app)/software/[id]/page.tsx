import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyRound } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getSoftware, softwareOptions } from "@/server/modules/software";
import { vendorOptions } from "@/server/modules/vendors";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit } from "@/components/form";
import { RenewalBadge } from "@/components/renewal-badge";
import { Badge, Card, DL, Empty, LinkButton, PageHeader, Table, fmtDate } from "@/components/ui";
import { deleteSoftwareAction, saveLicenseAction, saveSoftwareAction } from "../actions";
import { LicenseForm, SoftwareForm } from "../forms";
import { LICENSE_MODEL, SEAT_BASIS } from "../labels";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await db.software.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: s?.name ?? "Software" };
}

export default async function SoftwareDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; license?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const s = await getSoftware(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "software", "write");
  const needOptions = writable && (sp.edit || sp.license === "new");
  const [vendors, software, contracts] = needOptions
    ? await Promise.all([vendorOptions(), softwareOptions(), db.contract.findMany({ where: { deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } })])
    : [[], [], []];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/software", label: "Software" }]}
        title={s.name}
        subtitle={[s.vendor?.name, s.category].filter(Boolean).join(" · ") || undefined}
        actions={
          writable && (
            <>
              <LinkButton href={`/software/${id}?edit=1`}>Edit</LinkButton>
              <LinkButton href={`/software/${id}?license=new`} variant="primary">Add licence</LinkButton>
            </>
          )
        }
      />

      {writable && sp.edit && (
        <Card title="Edit software" className="mb-4">
          <SoftwareForm action={saveSoftwareAction.bind(null, id)} values={s} vendors={vendors} cancelHref={`/software/${id}`} />
          <ActionForm action={deleteSoftwareAction.bind(null, id)} className="mt-4 border-t border-line pt-4 text-right">
            <ConfirmSubmit message={`Delete ${s.name}? Only possible once it has no licences.`}>Delete software</ConfirmSubmit>
          </ActionForm>
        </Card>
      )}
      {writable && sp.license === "new" && (
        <Card title="New licence" className="mb-4">
          <LicenseForm action={saveLicenseAction.bind(null, null)} values={{ softwareId: id, vendorId: s.vendorId }} software={software} vendors={vendors} contracts={contracts} cancelHref={`/software/${id}`} editing={false} />
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Licences" value={s.summary.licenses} />
        <Stat label="Seats" value={s.summary.seats ?? "Unlimited"} />
        <Stat label="In use" value={s.summary.used} />
        <Stat label="Over-allocated" value={s.summary.over} danger={s.summary.over > 0} />
      </div>

      {s.licenses.length === 0 ? (
        <Empty title="No licences recorded">Add the licences you&apos;ve bought for {s.name}.</Empty>
      ) : (
        <Table>
          <thead><tr><th>Licence</th><th>Type</th><th>Seats</th><th>Expires</th><th>Contract</th><th /></tr></thead>
          <tbody>
            {s.licenses.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/software/licenses/${l.id}`} className="font-medium text-brand hover:underline">{l.name}</Link>
                  {l.hasKey && <KeyRound className="ml-1 inline h-3.5 w-3.5 text-muted" aria-label="Key stored" />}
                </td>
                <td className="text-xs">{LICENSE_MODEL[l.model]} · per {SEAT_BASIS[l.seatBasis].toLowerCase()}</td>
                <td className="tabular-nums">{l.usage.used} / {l.usage.seats ?? "∞"}{l.usage.over > 0 && <Badge tone="red" className="ml-1">+{l.usage.over}</Badge>}</td>
                <td className="whitespace-nowrap">{fmtDate(l.expiresAt) ?? "—"}</td>
                <td>{l.contract ? <Link href={`/vendors/contracts/${l.contract.id}`} className="hover:underline">{l.contract.title}</Link> : <span className="text-muted">—</span>}</td>
                <td>{l.state !== "active" && l.state !== "open" && <RenewalBadge state={l.state} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {(s.website || s.notes) && (
        <Card title="About" className="mt-4">
          <DL items={[["Website", s.website && <a href={s.website} target="_blank" rel="noopener noreferrer" className="break-all text-brand hover:underline">{s.website}</a>]]} />
          {s.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{s.notes}</p>}
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${danger ? "text-danger" : ""}`}>{value}</p>
    </div>
  );
}
