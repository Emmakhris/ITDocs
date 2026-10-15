"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import {
  addContractFile,
  coverAsset,
  deleteContact,
  deleteContract,
  deleteVendor,
  removeContractFile,
  saveContact,
  saveContract,
  saveVendor,
  uncoverAsset,
} from "@/server/modules/vendors";
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

export const saveVendorAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/vendors/${(await saveVendor(ctx, id, formToObject(fd))).id}`);
export const deleteVendorAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteVendor(ctx, id), "/vendors"));
export const saveContactAction = async (vendorId: string, id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await saveContact(ctx, vendorId, id, formToObject(fd)), `/vendors/${vendorId}`));
export const deleteContactAction = async (vendorId: string, id: string, _: ActionState) =>
  run(async (ctx) => (await deleteContact(ctx, vendorId, id), `/vendors/${vendorId}`));

export const saveContractAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/vendors/contracts/${(await saveContract(ctx, id, formToObject(fd))).id}`);
export const deleteContractAction = async (id: string, vendorId: string, _: ActionState) =>
  run(async (ctx) => (await deleteContract(ctx, id), `/vendors/${vendorId}`));
export const coverAssetAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await coverAsset(ctx, id, String(fd.get("assetId") ?? "")), `/vendors/contracts/${id}`));
export const uncoverAssetAction = async (id: string, assetId: string, _: ActionState) =>
  run(async (ctx) => (await uncoverAsset(ctx, id, assetId), `/vendors/contracts/${id}`));
export const contractFileAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await addContractFile(ctx, id, fd.get("file") as File | null), `/vendors/contracts/${id}`));
export const removeContractFileAction = async (attachmentId: string, _: ActionState) =>
  run(async (ctx) => `/vendors/contracts/${await removeContractFile(ctx, attachmentId)}`);
