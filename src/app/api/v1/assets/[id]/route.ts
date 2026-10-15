import { api, readJson } from "@/server/api/handler";
import { assetEditable, assetJson } from "@/server/api/serializers";
import { getAsset, updateAsset } from "@/server/modules/assets";

type P = { id: string };

/** One asset, by id or tag. */
export const GET = api<P>("assets", "read", async ({ ctx, params }) => assetJson(await getAsset(ctx, params.id)));

/**
 * Partial update: send only the fields to change. Location / assignee / status changes are written
 * to the movement log; include "changeReason" to say why.
 */
export const PATCH = api<P>("assets", "write", async ({ ctx, req, params }) => {
  const patch = await readJson(req);
  const current = await getAsset(ctx, params.id);
  const merged = {
    ...assetEditable(current),
    ...patch,
    customFields: { ...(current.customFields as Record<string, unknown>), ...((patch.customFields as Record<string, unknown>) ?? {}) },
  };
  await updateAsset(ctx, current.id, merged);
  return assetJson(await getAsset(ctx, current.id));
});
