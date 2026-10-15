import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getAsset } from "@/server/modules/assets";
import { locationTree } from "@/server/modules/locations";
import { NotFoundError } from "@/server/lib/errors";
import { Badge, Card, DL, LinkButton, StatusBadge } from "@/components/ui";
import { ScanActions } from "./scan-actions";

export const metadata = { title: "Scanned asset" };

/** Mobile-first quick actions after scanning a label: confirm location, move, check in. */
export default async function ScannedAsset({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const a = await getAsset(ctx, (await params).id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const locations = await locationTree();
  const open = a.checkouts.find((c) => !c.returnedAt);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <p className="font-mono text-lg font-semibold">{a.tag}</p>
        <p className="text-sm">{a.name}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge status={a.status} />
          <Badge>{a.type.name}</Badge>
          {a.storesPhi && <Badge tone="red">PHI</Badge>}
          {open && <Badge tone="amber">On loan: {open.person.name}</Badge>}
        </div>
        <div className="mt-4">
          <DL
            items={[
              ["Recorded location", a.locationPath],
              ["Assigned to", a.assignee?.name],
              ["Serial", a.serial],
            ]}
          />
        </div>
      </Card>
      {can(ctx.user.role, "assets", "write") && a.status !== "DISPOSED" && (
        <ScanActions
          assetId={a.id}
          currentLocationId={a.locationId}
          checkedOut={!!open}
          locations={locations.map((l) => ({ id: l.id, name: l.name, path: l.path, depth: l.depth }))}
        />
      )}
      <div className="flex gap-2">
        <LinkButton href={`/assets/${a.id}`} className="flex-1">Full record</LinkButton>
        <LinkButton href="/scan" variant="primary" className="flex-1">Scan next</LinkButton>
      </div>
    </div>
  );
}
