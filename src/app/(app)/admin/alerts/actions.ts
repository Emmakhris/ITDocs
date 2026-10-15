"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { runNow, saveAlertSettings, sendTest } from "@/server/modules/alerts";

const OUTCOME = { sent: "Sent.", skipped: "Not sent: that channel isn't configured.", failed: "Sending failed — see the log below.", duplicate: "Already sent." } as const;

export async function saveAlertSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    await saveAlertSettings(await requireCtx(), formToObject(fd));
    revalidatePath("/admin/alerts");
    return { ok: true, message: "Alert settings saved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function testAction(channel: "email" | "teams", _: ActionState): Promise<ActionState> {
  try {
    const r = await sendTest(await requireCtx(), channel);
    revalidatePath("/admin/alerts");
    return { ok: r === "sent", error: r === "sent" ? undefined : OUTCOME[r], message: OUTCOME[r] };
  } catch (e) {
    return toActionError(e);
  }
}

export async function runNowAction(what: "digest" | "scheduled", _: ActionState): Promise<ActionState> {
  try {
    const r = await runNow(await requireCtx(), what);
    revalidatePath("/admin/alerts");
    const msg =
      "reports" in r
        ? `Scheduled jobs ran: ${r.reports} report(s) sent${r.digest ? `, digest ${r.digest}` : ""}.`
        : r.status === "done"
          ? `Digest: ${r.total} item(s). Email ${r.email}, Teams ${r.teams}.`
          : `Digest: ${r.status}.`;
    return { ok: true, message: msg };
  } catch (e) {
    return toActionError(e);
  }
}
