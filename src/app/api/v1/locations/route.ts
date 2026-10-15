import { api } from "@/server/api/handler";
import { assertCan } from "@/server/rbac/permissions";
import { locationTree } from "@/server/modules/locations";

/** Every location with its full path, in tree order. */
export const GET = api("locations", "read", async ({ ctx }) => {
  assertCan(ctx.user.role, "locations", "read");
  return {
    data: (await locationTree()).map((l) => ({ id: l.id, name: l.name, type: l.type, code: l.code, parentId: l.parentId, path: l.path, assetCount: l.assetCount })),
  };
});
