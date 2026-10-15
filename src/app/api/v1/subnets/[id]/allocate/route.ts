import { api, readJson } from "@/server/api/handler";
import { allocateNextIp } from "@/server/modules/network";

/** Allocate the next free address (outside the gateway and DHCP pool): { hostname?, assetId?, macAddress?, status?: ASSIGNED|RESERVED, notes? }. */
export const POST = api<{ id: string }>("network", "write", async ({ ctx, req, params }) => {
  const ip = await allocateNextIp(ctx, params.id, await readJson(req));
  return { id: ip.id, address: ip.address, status: ip.status, hostname: ip.hostname, assetId: ip.assetId };
});
