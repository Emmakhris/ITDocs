import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getLocation, locationPath, locationTree } from "@/server/modules/locations";
import { listAssets, recentMovements } from "@/server/modules/assets";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { Card, DL, LinkButton, PageHeader, StatusBadge, Table, Badge } from "@/components/ui";
import { MovementTimeline } from "@/components/movement-timeline";
import { DocumentationCard } from "@/components/kb-links";
import { articlesFor } from "@/server/modules/kb";
import { LocationForm } from "../location-form";
import { saveLocationAction, deleteLocationAction } from "../actions";
import { DeleteLocation } from "./delete-location";

export default async function LocationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { edit } = await searchParams;
  const loc = await getLocation(id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "locations", "write");

  if (edit && writable) {
    const locations = (await locationTree()).map((l) => ({ id: l.id, name: l.name, path: l.path, depth: l.depth }));
    return (
      <>
        <PageHeader title={`Edit ${loc.name}`} crumbs={[{ href: "/locations", label: "Locations" }, { href: `/locations/${id}`, label: loc.name }]} />
        <LocationForm action={saveLocationAction.bind(null, id)} values={{ id, name: loc.name, type: loc.type, parentId: loc.parentId, code: loc.code, address: loc.address, notes: loc.notes }} locations={locations} cancelHref={`/locations/${id}`} />
      </>
    );
  }

  const [path, assets, movements, statusCounts, articles] = await Promise.all([
    locationPath(db, id),
    listAssets(ctx, { locationId: id, pageSize: 25 }),
    recentMovements(ctx, { locationId: id, take: 15 }),
    db.asset.groupBy({ by: ["status"], where: { locationId: id, deletedAt: null }, _count: true }),
    articlesFor(ctx, "Location", id),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/locations", label: "Locations" }, ...(loc.parent ? [{ href: `/locations/${loc.parent.id}`, label: loc.parent.name }] : [])]}
        title={loc.name}
        subtitle={path}
        actions={
          writable && (
            <>
              <LinkButton href={`/locations/new?parentId=${id}`}>Add sub-location</LinkButton>
              <LinkButton href={`/assets/new?locationId=${id}`}>Add asset here</LinkButton>
              <LinkButton href={`/locations/${id}?edit=1`} variant="primary">Edit</LinkButton>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title={`Assets here and below (${assets.total})`}
            actions={<Link href={`/assets?locationId=${id}`} className="text-xs text-brand hover:underline">Open in asset list</Link>}
          >
            {assets.rows.length ? (
              <Table>
                <thead>
                  <tr><th>Tag</th><th>Name</th><th>Status</th><th>Exact location</th></tr>
                </thead>
                <tbody>
                  {assets.rows.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs"><Link className="text-brand hover:underline" href={`/assets/${a.id}`}>{a.tag}</Link></td>
                      <td>{a.name}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td>{a.location?.name}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No assets.</p>
            )}
          </Card>
          <Card title="Recent movements in / out">
            <MovementTimeline items={movements.rows} showAsset />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Details">
            <DL
              items={[
                ["Type", <Badge key="t">{loc.type.toLowerCase()}</Badge>],
                ["Code", loc.code],
                ["Address", loc.address],
                ["Directly here", statusCounts.reduce((s, x) => s + x._count, 0)],
              ]}
            />
            {loc.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{loc.notes}</p>}
          </Card>
          {can(ctx.user.role, "kb", "read") && <DocumentationCard articles={articles} canWrite={can(ctx.user.role, "kb", "write")} />}
          <Card title="Sub-locations">
            {loc.children.length ? (
              <ul className="space-y-1 text-sm">
                {loc.children.map((c) => (
                  <li key={c.id}><Link className="text-brand hover:underline" href={`/locations/${c.id}`}>{c.name}</Link></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None.</p>
            )}
          </Card>
          {writable && <DeleteLocation action={deleteLocationAction.bind(null, id)} />}
        </div>
      </div>
    </>
  );
}
