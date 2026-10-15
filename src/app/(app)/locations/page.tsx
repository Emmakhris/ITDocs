import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { locationTree } from "@/server/modules/locations";
import { Badge, Empty, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Locations" };

export default async function LocationsPage() {
  const ctx = await requireCtx();
  const tree = await locationTree();
  return (
    <>
      <PageHeader
        title="Locations"
        subtitle="Sites, buildings, floors, rooms and storage. Asset counts are for that level only."
        actions={can(ctx.user.role, "locations", "write") && <LinkButton href="/locations/new" variant="primary">New location</LinkButton>}
      />
      {tree.length === 0 ? (
        <Empty title="No locations yet">Start with a site (e.g. your main campus), then add buildings and rooms under it.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {tree.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm" style={{ paddingLeft: 12 + l.depth * 22 }}>
              <Link href={`/locations/${l.id}`} className={l.depth === 0 ? "font-semibold hover:underline" : "hover:underline"}>
                {l.name}
              </Link>
              <Badge>{l.type.toLowerCase()}</Badge>
              {l.code && <span className="font-mono text-xs text-muted">{l.code}</span>}
              {l.assetCount > 0 && (
                <Link href={`/assets?locationId=${l.id}`} className="ml-auto text-xs text-brand hover:underline">
                  {l.assetCount} asset{l.assetCount === 1 ? "" : "s"}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
