import { api } from "@/server/api/handler";
import { getSubnet } from "@/server/modules/network";

/** One subnet with every recorded address and the next free one. */
export const GET = api<{ id: string }>("network", "read", async ({ ctx, params }) => {
  const s = await getSubnet(ctx, params.id);
  return {
    id: s.id,
    cidr: s.cidr,
    name: s.name,
    mask: s.info.mask,
    gateway: s.gateway,
    dhcpStart: s.dhcpStart,
    dhcpEnd: s.dhcpEnd,
    dns: s.dns,
    usage: s.usage,
    nextFree: s.nextFree,
    addresses: s.addresses.map((a) => ({
      id: a.id,
      address: a.address,
      status: a.status,
      hostname: a.hostname,
      macAddress: a.macAddress,
      asset: a.asset ? { id: a.asset.id, tag: a.asset.tag } : null,
      notes: a.notes,
    })),
  };
});
