"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { createDepartment, createPerson, updatePerson } from "@/server/modules/people";

export async function savePersonAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let target: string;
  try {
    const ctx = await requireCtx();
    target = id ? (await updatePerson(ctx, id, formToObject(fd))).id : (await createPerson(ctx, formToObject(fd))).id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/people/${target}`);
}

export async function addDepartmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const ctx = await requireCtx();
    await createDepartment(ctx, String(fd.get("name") ?? ""), String(fd.get("costCenter") ?? ""));
    revalidatePath("/people");
    return { ok: true, message: "Department added." };
  } catch (e) {
    return toActionError(e);
  }
}
