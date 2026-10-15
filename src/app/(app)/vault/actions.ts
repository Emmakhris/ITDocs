"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { AppError } from "@/server/lib/errors";
import {
  addFolderGrant,
  createCredential,
  deleteCredential,
  deleteFolder,
  linkAsset,
  removeFolderGrant,
  reveal,
  saveFolder,
  unlinkAsset,
  updateCredential,
  type RevealWhat,
} from "@/server/modules/vault";

export async function saveFolderAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireCtx();
    target = (await saveFolder(ctx, id, formToObject(fd))).id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/vault/folders/${target}`);
}

export async function deleteFolderAction(id: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await deleteFolder(ctx, id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/vault");
}

export async function addGrantAction(folderId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    const o = formToObject(fd);
    const who = String(o.who ?? "");
    await addFolderGrant(ctx, folderId, {
      level: o.level,
      ...(who.startsWith("role:") ? { role: who.slice(5) } : who.startsWith("user:") ? { userId: who.slice(5) } : {}),
    });
    revalidatePath(`/vault/folders/${folderId}`);
    return { ok: true, message: "Access granted." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeGrantAction(grantId: string, folderId: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await removeFolderGrant(ctx, grantId);
    revalidatePath(`/vault/folders/${folderId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveCredentialAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireCtx();
    const input = formToObject(fd);
    // Secrets are taken verbatim (formToObject trims; leading/trailing spaces can be part of a password)
    input.password = (fd.get("password") as string) || undefined;
    if (id) {
      target = (await updateCredential(ctx, id, input)).id;
    } else {
      target = (await createCredential(ctx, input)).id;
      if (typeof input.assetId === "string") await linkAsset(ctx, target, input.assetId);
    }
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/vault/${target}`);
}

export async function deleteCredentialAction(id: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await deleteCredential(ctx, id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/vault");
}

/** Returns the decrypted value to the browser. Audited in the service before returning. */
export async function revealAction(id: string, what: RevealWhat, purpose: "reveal" | "copy"): Promise<{ value?: string; error?: string }> {
  try {
    const ctx = await requireCtx();
    return { value: await reveal(ctx, id, what, purpose) };
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Could not decrypt this secret. Check the server log." };
  }
}

export async function linkAssetAction(credentialId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    const assetId = String(fd.get("assetId") ?? "");
    if (!assetId) return { error: "Choose an asset." };
    await linkAsset(ctx, credentialId, assetId);
    revalidatePath(`/vault/${credentialId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}

export async function unlinkAssetAction(credentialId: string, assetId: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await unlinkAsset(ctx, credentialId, assetId);
    revalidatePath(`/vault/${credentialId}`);
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
