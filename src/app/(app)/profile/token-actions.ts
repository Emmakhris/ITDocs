"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { createToken, revokeToken } from "@/server/modules/api-tokens";

export type CreateTokenState = ActionState & { token?: string; name?: string };

export async function createTokenAction(_: CreateTokenState, fd: FormData): Promise<CreateTokenState> {
  try {
    const ctx = await requireCtx();
    const input = { ...formToObject(fd), scopes: fd.getAll("scopes").map(String) };
    const { token, row } = await createToken(ctx, input);
    revalidatePath("/profile");
    return { ok: true, token, name: row.name };
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeTokenAction(id: string, back: string, _: ActionState): Promise<ActionState> {
  try {
    await revokeToken(await requireCtx(), id);
    revalidatePath(back);
    return { ok: true, message: "Token revoked." };
  } catch (e) {
    return toActionError(e);
  }
}
