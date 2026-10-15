"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { AppError } from "@/server/lib/errors";
import { assignSeat, deleteLicense, deleteSoftware, revealLicenseKey, saveLicense, saveSoftware, unassignSeat } from "@/server/modules/software";
import type { Ctx } from "@/server/context";

/** Runs a write and redirects to the returned path; errors come back to the form. */
async function run(fn: (ctx: Ctx) => Promise<string>): Promise<ActionState> {
  let target: string;
  try {
    target = await fn(await requireCtx());
  } catch (e) {
    return toActionError(e);
  }
  redirect(target);
}

export const saveSoftwareAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/software/${(await saveSoftware(ctx, id, formToObject(fd))).id}`);
export const deleteSoftwareAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteSoftware(ctx, id), "/software"));

export const saveLicenseAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/software/licenses/${(await saveLicense(ctx, id, formToObject(fd))).id}`);
export const deleteLicenseAction = async (id: string, softwareId: string, _: ActionState) =>
  run(async (ctx) => (await deleteLicense(ctx, id), `/software/${softwareId}`));

export const assignSeatAction = async (licenseId: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const { over } = await assignSeat(ctx, licenseId, formToObject(fd));
    return `/software/licenses/${licenseId}${over ? `?over=${over}` : ""}`;
  });
export const unassignSeatAction = async (assignmentId: string, _: ActionState) =>
  run(async (ctx) => `/software/licenses/${await unassignSeat(ctx, assignmentId)}`);

export async function revealKeyAction(id: string, purpose: "reveal" | "copy"): Promise<{ value?: string; error?: string }> {
  try {
    return { value: await revealLicenseKey(await requireCtx(), id, purpose) };
  } catch (e) {
    return { error: e instanceof AppError ? e.message : "Could not decrypt this key. Check the server log." };
  }
}
