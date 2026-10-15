"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import {
  checkinAsset,
  checkoutAsset,
  createAsset,
  deleteAsset,
  disposeAsset,
  moveAssets,
  updateAsset,
} from "@/server/modules/assets";

/** Pull `cf_<key>` inputs into a customFields object. */
function assetPayload(fd: FormData) {
  const o = formToObject(fd);
  const customFields: Record<string, unknown> = {};
  for (const k of Object.keys(o)) {
    if (k.startsWith("cf_")) {
      customFields[k.slice(3)] = o[k];
      delete o[k];
    }
  }
  return { ...o, customFields };
}

export async function createAssetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const ctx = await requireCtx();
    id = (await createAsset(ctx, assetPayload(fd))).id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/assets/${id}`);
}

export async function updateAssetAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await updateAsset(ctx, id, assetPayload(fd));
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/assets/${id}`);
}

export async function moveAction(ids: string[], method: "MANUAL" | "SCAN", _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    const { moved } = await moveAssets(ctx, ids, formToObject(fd), method);
    revalidatePath("/", "layout");
    if (method === "SCAN") return { ok: true, message: "Location confirmed and logged." };
    return { ok: true, message: moved ? `Recorded movement for ${moved} asset${moved === 1 ? "" : "s"}.` : "Nothing changed — asset already there." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checkoutAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await checkoutAsset(ctx, id, formToObject(fd));
    revalidatePath("/", "layout");
    return { ok: true, message: "Checked out." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checkinAction(id: string, method: "CHECKIN" | "SCAN", _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await checkinAsset(ctx, id, formToObject(fd), method);
    revalidatePath("/", "layout");
    return { ok: true, message: "Checked in." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function disposeAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await disposeAsset(ctx, id, formToObject(fd));
    revalidatePath("/", "layout");
    return { ok: true, message: "Disposal recorded." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteAssetAction(id: string): Promise<void> {
  const ctx = await requireCtx();
  await deleteAsset(ctx, id);
  redirect("/assets");
}
