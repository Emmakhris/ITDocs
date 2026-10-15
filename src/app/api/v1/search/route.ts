import { api } from "@/server/api/handler";
import { globalSearch } from "@/server/modules/search";

// Which token scope each kind of search hit belongs to
const KIND_SCOPE: Record<string, string> = {
  Asset: "assets",
  Location: "locations",
  Person: "people",
  Subnet: "network",
  "IP address": "network",
  VLAN: "network",
  Rack: "network",
  "Switch port": "network",
  "Wi-Fi": "network",
  Article: "kb",
  Software: "software",
  Licence: "software",
  Vendor: "vendors",
  Contract: "vendors",
  Change: "changes",
  Incident: "changes",
  Journal: "changes",
};

/** Global search (same as the search box), limited to the token's scopes. Credentials are never returned. */
export const GET = api(null, "read", async ({ ctx, url, token }) => {
  const hits = await globalSearch(ctx, (url.searchParams.get("q") ?? "").slice(0, 100), 10);
  return { data: hits.filter((h) => KIND_SCOPE[h.kind] && (!token.scopes.length || token.scopes.includes(KIND_SCOPE[h.kind]))) };
});
