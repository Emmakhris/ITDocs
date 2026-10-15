"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { createLocation, deleteLocation, updateLocation } from "@/server/modules/locations";

export async function saveLocationAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireCtx();
    target = id ? (await updateLocation(ctx, id, formToObject(fd))).id : (await createLocation(ctx, formToObject(fd))).id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/locations/${target}`);
}

export async function deleteLocationAction(id: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await deleteLocation(ctx, id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/locations");
}
