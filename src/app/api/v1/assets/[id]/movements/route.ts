import { api } from "@/server/api/handler";
import { movementJson } from "@/server/api/serializers";
import { assetMovements, getAsset } from "@/server/modules/assets";

/** The asset's movement history, newest first (?limit=, max 1000). */
export const GET = api<{ id: string }>("assets", "read", async ({ ctx, params, url }) => {
  const a = await getAsset(ctx, params.id);
  const take = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  return { data: (await assetMovements(ctx, a.id, take)).map(movementJson) };
});
