import { AssetStatus } from "@prisma/client";
import { api, paging, readJson } from "@/server/api/handler";
import { assetJson } from "@/server/api/serializers";
import { createAsset, listAssets } from "@/server/modules/assets";

/** List assets. Filters: q, status, typeId, locationId (includes sub-locations), assigneeId; page, pageSize (max 200). */
export const GET = api("assets", "read", async ({ ctx, url }) => {
  const { page, pageSize } = paging(url);
  const sp = url.searchParams;
  const status = sp.get("status");
  const r = await listAssets(ctx, {
    q: sp.get("q") ?? undefined,
    status: status && status in AssetStatus ? (status as AssetStatus) : undefined,
    typeId: sp.get("typeId") ?? undefined,
    locationId: sp.get("locationId") ?? undefined,
    assigneeId: sp.get("assigneeId") ?? undefined,
    page,
    pageSize,
  });
  return { data: r.rows.map(assetJson), page: r.page, pageSize: r.pageSize, total: r.total };
});

/** Create an asset. Body uses the same fields as the asset form; the tag is generated if omitted. */
export const POST = api("assets", "write", async ({ ctx, req }) => assetJson(await createAsset(ctx, await readJson(req))));
