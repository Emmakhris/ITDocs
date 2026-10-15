"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { toActionError, type ActionState } from "@/server/lib/forms";
import { changeOwnPassword, enableTotp } from "@/server/modules/users";

export async function enableTotpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await enableTotp(ctx, String(fd.get("secret") ?? ""), String(fd.get("code") ?? ""));
    revalidatePath("/profile");
    return { ok: true, message: "MFA enabled. You'll be asked for a code at every sign-in." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await changeOwnPassword(ctx, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""));
    return { ok: true, message: "Password changed." };
  } catch (e) {
    return toActionError(e);
  }
}
