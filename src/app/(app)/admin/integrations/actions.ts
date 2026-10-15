"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { toActionError, type ActionState } from "@/server/lib/forms";
import { AppError } from "@/server/lib/errors";
import { MAX_ATTACHMENT_BYTES } from "@/server/lib/storage";
import { runSync, type SyncSource } from "@/server/modules/sync";

export async function runSyncAction(source: SyncSource, _: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireCtx();
    let csv: string | undefined;
    if (source === "sccm") {
      const f = fd.get("file");
      if (!(f instanceof File) || !f.size) throw new AppError("Choose the ConfigMgr CSV export.");
      if (f.size > MAX_ATTACHMENT_BYTES) throw new AppError("The CSV can be at most 10 MB.");
      csv = await f.text();
    }
    const run = await runSync(ctx, source, {
      dryRun: fd.get("mode") !== "apply",
      force: fd.get("force") === "on",
      createMissing: fd.get("createMissing") === "on",
      assetTypeId: String(fd.get("assetTypeId") ?? "") || undefined,
      csv,
    });
    id = run.id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/admin/integrations?run=${id}#run`);
}
