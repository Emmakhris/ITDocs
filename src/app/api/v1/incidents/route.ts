import { IncidentSeverity } from "@prisma/client";
import { api, readJson } from "@/server/api/handler";
import { incidentNo } from "@/server/lib/workflow";
import { createIncident, listIncidents } from "@/server/modules/incidents";

/** Incidents. view=open|recent|all (default open), severity, q. */
export const GET = api("changes", "read", async ({ ctx, url }) => {
  const view = (["open", "recent", "all"].find((v) => v === url.searchParams.get("view")) ?? "open") as "open" | "recent" | "all";
  const sev = url.searchParams.get("severity");
  const rows = await listIncidents(ctx, { view, q: url.searchParams.get("q") ?? undefined, severity: sev && sev in IncidentSeverity ? (sev as IncidentSeverity) : undefined });
  return { data: rows.map((i) => ({ ...i, number: incidentNo(i.number), owner: i.owner?.displayName ?? null })) };
});

/** Open an incident (e.g. from monitoring): { title, severity: P1..P4, description?, impact?, startedAt?, ticketRef? }. P1/P2 trigger alerts. */
export const POST = api("changes", "write", async ({ ctx, req }) => {
  const i = await createIncident(ctx, await readJson(req));
  return { id: i.id, number: incidentNo(i.number), title: i.title, severity: i.severity, status: i.status };
});
