import { api } from "@/server/api/handler";
import { listSubnets } from "@/server/modules/network";

/** Subnets with usage (?q= filters by name or network). */
export const GET = api("network", "read", async ({ ctx, url }) => ({
  data: (await listSubnets(ctx, { q: url.searchParams.get("q") ?? undefined })).map((s) => ({
    id: s.id,
    cidr: s.cidr,
    name: s.name,
    vlan: s.vlan ? { id: s.vlan.id, number: s.vlan.number, name: s.vlan.name } : null,
    gateway: s.gateway,
    dhcpStart: s.dhcpStart,
    dhcpEnd: s.dhcpEnd,
    dns: s.dns,
    usage: s.usage,
  })),
}));
