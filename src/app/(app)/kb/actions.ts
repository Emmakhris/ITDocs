"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import {
  addAttachment,
  createArticle,
  deleteArticle,
  deleteCategory,
  linkArticle,
  markReviewed,
  removeAttachment,
  restoreVersion,
  saveCategory,
  unlinkArticle,
  updateArticle,
} from "@/server/modules/kb";
import type { Ctx } from "@/server/context";

/** Runs a KB write and redirects to the returned path; errors come back to the form. */
async function run(fn: (ctx: Ctx) => Promise<string>): Promise<ActionState> {
  let target: string;
  try {
    target = await fn(await requireCtx());
  } catch (e) {
    return toActionError(e);
  }
  redirect(target);
}

export const saveArticleAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const input = formToObject(fd);
    input.body = fd.get("body") ?? ""; // keep the body's own whitespace (formToObject trims)
    const a = id ? await updateArticle(ctx, id, input) : await createArticle(ctx, input);
    return `/kb/${a.id}`;
  });

export const deleteArticleAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteArticle(ctx, id), "/kb"));
export const reviewedAction = async (id: string, _: ActionState) => run(async (ctx) => (await markReviewed(ctx, id), `/kb/${id}`));
export const restoreAction = async (id: string, version: number, _: ActionState) =>
  run(async (ctx) => (await restoreVersion(ctx, id, version), `/kb/${id}`));

export const linkAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const toType = String(fd.get("toType") ?? "");
    await linkArticle(ctx, id, toType, String(fd.get(toType === "Location" ? "locationId" : "assetId") ?? ""));
    return `/kb/${id}`;
  });
export const unlinkAction = async (id: string, toType: string, toId: string, _: ActionState) =>
  run(async (ctx) => (await unlinkArticle(ctx, id, toType, toId), `/kb/${id}`));

export const attachAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await addAttachment(ctx, id, fd.get("file") as File | null), `/kb/${id}`));
export const detachAction = async (attachmentId: string, _: ActionState) =>
  run(async (ctx) => `/kb/${await removeAttachment(ctx, attachmentId)}`);

export const saveCategoryAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/kb?categoryId=${(await saveCategory(ctx, id, formToObject(fd))).id}`);
export const deleteCategoryAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteCategory(ctx, id), "/kb"));
