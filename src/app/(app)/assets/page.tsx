import Link from "next/link";
import type { AssetStatus } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { listAssets, type AssetListFilter } from "@/server/modules/assets";
import { listAssetTypes } from "@/server/modules/asset-types";
import { locationTree } from "@/server/modules/locations";
import { Button, Input, LinkButton, PageHeader, Pagination, Select, STATUS_META } from "@/components/ui";
import { LocationSelect } from "@/components/pickers";
import { AssetTable } from "./asset-table";

export const metadata = { title: "Assets" };

type SP = Record<string, string | undefined>;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const filter: AssetListFilter = {
    q: sp.q,
    status: sp.status && sp.status in STATUS_META ? (sp.status as AssetStatus) : undefined,
    typeId: sp.typeId,
    locationId: sp.locationId,
    assigneeId: sp.assigneeId,
    medical: sp.medical === "1",
    phi: sp.phi === "1",
    warrantyBefore: sp.warranty ? new Date(Date.now() + Number(sp.warranty) * 86_400_000) : undefined,
    sort: (["tag", "name", "status", "updatedAt", "warrantyEnd"] as const).find((s) => s === sp.sort),
    dir: sp.dir === "desc" ? "desc" : "asc",
    page: Number(sp.page) || 1,
  };
  const [{ rows, total, page, pageSize }, types, locations] = await Promise.all([
    listAssets(ctx, filter),
    listAssetTypes(),
    locationTree(),
  ]);
  const qs = (patch: SP) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/assets?${p}`;
  };
  const writable = can(ctx.user.role, "assets", "write");
  const exportHref = `/api/assets/export?${new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][])}`;

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle={`${total.toLocaleString()} asset${total === 1 ? "" : "s"}`}
        actions={
          <>
            <LinkButton href={exportHref} prefetch={false}>Export CSV</LinkButton>
            {writable && <LinkButton href="/assets/import">Import</LinkButton>}
            {writable && <LinkButton href="/assets/new" variant="primary">New asset</LinkButton>}
          </>
        }
      />

      <form className="mb-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_180px_200px_auto]">
        <Input name="q" defaultValue={sp.q} placeholder="Tag, name, serial, hostname, IP, MAC, assignee…" aria-label="Search" />
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </Select>
        <Select name="typeId" defaultValue={sp.typeId ?? ""} aria-label="Type">
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <LocationSelect name="locationId" locations={locations} defaultValue={sp.locationId} emptyLabel="All locations" />
        <div className="flex gap-2">
          <Button type="submit">Filter</Button>
          <LinkButton href="/assets" variant="ghost">Reset</LinkButton>
        </div>
      </form>

      {(sp.warranty || sp.phi || sp.medical || sp.assigneeId) && (
        <p className="mb-3 text-sm text-muted">
          Extra filter: {sp.warranty && `warranty ending within ${sp.warranty} days`} {sp.phi && "PHI-flagged devices"} {sp.medical && "medical devices"}{" "}
          {sp.assigneeId && "assigned to selected person"} · <Link className="text-brand hover:underline" href="/assets">clear</Link>
        </p>
      )}

      <AssetTable
        writable={writable}
        locations={locations.map((l) => ({ id: l.id, name: l.name, path: l.path, depth: l.depth }))}
        sort={{
          key: filter.sort ?? "tag",
          dir: filter.dir ?? "asc",
          hrefs: Object.fromEntries(
            (["tag", "name", "status", "warrantyEnd"] as const).map((k) => [
              k,
              qs({ sort: k, dir: (filter.sort ?? "tag") === k && filter.dir === "asc" ? "desc" : "asc", page: undefined }),
            ]),
          ),
        }}
        rows={rows.map((a) => ({
          id: a.id,
          tag: a.tag,
          name: a.name,
          type: a.type.name,
          status: a.status,
          serial: a.serial,
          location: a.location?.name ?? null,
          assignee: a.assignee?.name ?? null,
          warrantyEnd: a.warrantyEnd?.toISOString() ?? null,
          storesPhi: a.storesPhi,
        }))}
      />
      <Pagination page={page} pageSize={pageSize} total={total} href={(p) => qs({ page: String(p) })} />
    </>
  );
}
