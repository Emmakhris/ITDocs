import { api, readJson } from "@/server/api/handler";
import { assetJson } from "@/server/api/serializers";
import { getAsset, moveAssets } from "@/server/modules/assets";

/** Move an asset: { toLocationId?, toAssigneeId?, clearAssignee?, toStatus?, reason (required), ticketRef? }. */
export const POST = api<{ id: string }>("assets", "write", async ({ ctx, req, params }) => {
  const a = await getAsset(ctx, params.id);
  await moveAssets(ctx, [a.id], await readJson(req));
  return assetJson(await getAsset(ctx, a.id));
});
