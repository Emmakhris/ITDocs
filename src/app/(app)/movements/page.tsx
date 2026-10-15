import { requireCtx } from "@/server/auth/session";
import { recentMovements } from "@/server/modules/assets";
import { locationTree } from "@/server/modules/locations";
import { Button, Card, Input, LinkButton, PageHeader, Pagination } from "@/components/ui";
import { LocationSelect } from "@/components/pickers";
import { MovementTimeline } from "@/components/movement-timeline";

export const metadata = { title: "Movement log" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ q?: string; locationId?: string; page?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 50;
  const [{ rows, total }, locations] = await Promise.all([
    recentMovements(ctx, { q: sp.q, locationId: sp.locationId, take: pageSize, skip: (page - 1) * pageSize }),
    locationTree(),
  ]);
  const qs = (p: number) => `/movements?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.locationId ? { locationId: sp.locationId } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Movement log" subtitle="Every location, assignee and status change across all assets. Entries cannot be edited or deleted." />
      <form className="mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-[1fr_260px_auto]">
        <Input name="q" defaultValue={sp.q} placeholder="Asset tag or name…" aria-label="Asset" />
        <LocationSelect name="locationId" locations={locations} defaultValue={sp.locationId} emptyLabel="Any location (in or out)" />
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <LinkButton href="/movements" variant="ghost">Reset</LinkButton>
        </div>
      </form>
      <Card>
        <MovementTimeline items={rows} showAsset />
      </Card>
      <Pagination page={page} pageSize={pageSize} total={total} href={qs} />
    </>
  );
}
