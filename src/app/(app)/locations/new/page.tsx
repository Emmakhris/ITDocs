import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { locationTree } from "@/server/modules/locations";
import { PageHeader } from "@/components/ui";
import { LocationForm } from "../location-form";
import { saveLocationAction } from "../actions";

export const metadata = { title: "New location" };

export default async function NewLocation({ searchParams }: { searchParams: Promise<{ parentId?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "locations", "write");
  const { parentId } = await searchParams;
  const locations = (await locationTree()).map((l) => ({ id: l.id, name: l.name, path: l.path, depth: l.depth }));
  return (
    <>
      <PageHeader title="New location" crumbs={[{ href: "/locations", label: "Locations" }]} />
      <LocationForm action={saveLocationAction.bind(null, null)} values={{ parentId }} locations={locations} cancelHref="/locations" />
    </>
  );
}
