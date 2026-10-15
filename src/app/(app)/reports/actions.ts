"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { createSubscription, deleteSubscription, runSubscriptionNow } from "@/server/modules/alerts";

export async function subscribeAction(reportKey: string, params: Record<string, string | number>, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await createSubscription(ctx, { ...formToObject(fd), reportKey, params });
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/reports/${reportKey}`);
}

export async function unsubscribeAction(reportKey: string, id: string, _: ActionState): Promise<ActionState> {
  try {
    await deleteSubscription(await requireCtx(), id);
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/reports/${reportKey}`);
}

export async function sendNowAction(id: string, _: ActionState): Promise<ActionState> {
  try {
    const r = await runSubscriptionNow(await requireCtx(), id);
    return { ok: true, message: r === "sent" ? "Sent." : r === "skipped" ? "Not sent: email is not configured (see Admin › Alerts)." : "Sending failed — see Admin › Alerts for the error." };
  } catch (e) {
    return toActionError(e);
  }
}
