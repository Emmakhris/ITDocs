import { ChangeStatus } from "@prisma/client";
import { api } from "@/server/api/handler";
import { changeNo } from "@/server/lib/workflow";
import { listChanges, type ChangeView } from "@/server/modules/changes";

/** Changes. view=open|upcoming|recent|all (default open), status, q. */
export const GET = api("changes", "read", async ({ ctx, url }) => {
  const view = (["open", "upcoming", "recent", "all"].find((v) => v === url.searchParams.get("view")) ?? "open") as ChangeView;
  const st = url.searchParams.get("status");
  const rows = await listChanges(ctx, { view, q: url.searchParams.get("q") ?? undefined, status: st && st in ChangeStatus ? (st as ChangeStatus) : undefined });
  return { data: rows.map((c) => ({ ...c, number: changeNo(c.number) })) };
});
