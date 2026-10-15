"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { updateSettings } from "@/server/modules/settings";
import { deleteAssetType, saveAssetType } from "@/server/modules/asset-types";
import { createLocalUser, deleteGroupMapping, saveGroupMapping, setUserRoleActive } from "@/server/modules/users";

export async function saveSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    const o = formToObject(fd);
    await updateSettings(ctx, {
      orgName: z.string().trim().min(1).max(120).parse(o.orgName),
      assetTagPrefix: z.string().trim().max(10).parse(o.assetTagPrefix ?? ""),
      labelSubtitle: z.string().trim().max(80).parse(o.labelSubtitle ?? ""),
      medicalModule: o.medicalModule === "on",
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Settings saved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveAssetTypeAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await saveAssetType(ctx, id, formToObject(fd));
  } catch (e) {
    return toActionError(e);
  }
  redirect("/admin/types");
}

export async function deleteAssetTypeAction(id: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await deleteAssetType(ctx, id);
  } catch (e) {
    return toActionError(e);
  }
  redirect("/admin/types");
}

export async function updateUserAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await setUserRoleActive(ctx, id, z.nativeEnum(Role).parse(fd.get("role")), fd.get("active") === "on");
    revalidatePath("/admin/users");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createLocalUserAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    const o = formToObject(fd) as Record<string, string>;
    await createLocalUser(ctx, { username: o.username ?? "", displayName: o.displayName ?? "", password: o.password ?? "", role: "ADMIN" });
    revalidatePath("/admin/users");
    return { ok: true, message: "Break-glass account created. Ask the holder to enrol MFA on first sign-in." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveMappingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await saveGroupMapping(ctx, String(fd.get("groupName") ?? ""), z.nativeEnum(Role).parse(fd.get("role")), Number(fd.get("priority") ?? 0) || 0);
    revalidatePath("/admin/users");
    return { ok: true, message: "Mapping saved." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteMappingAction(id: string, _: ActionState): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await deleteGroupMapping(ctx, id);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    return toActionError(e);
  }
}
