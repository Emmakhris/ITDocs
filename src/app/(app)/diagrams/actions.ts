"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { createDiagram, deleteDiagram, linkDiagramAsset, updateDiagram, uploadDiagramVersion } from "@/server/modules/diagrams";
import type { Ctx } from "@/server/context";

async function run(fn: (ctx: Ctx) => Promise<string>): Promise<ActionState> {
  let target: string;
  try {
    target = await fn(await requireCtx());
  } catch (e) {
    return toActionError(e);
  }
  redirect(target);
}

export const createDiagramAction = async (_: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const { file: _f, ...rest } = formToObject(fd);
    return `/diagrams/${(await createDiagram(ctx, rest, fd.get("file") as File | null)).id}`;
  });
export const updateDiagramAction = async (id: string, _: ActionState, fd: FormData) => run(async (ctx) => (await updateDiagram(ctx, id, formToObject(fd)), `/diagrams/${id}`));
export const uploadVersionAction = async (id: string, _: ActionState, fd: FormData) => run(async (ctx) => (await uploadDiagramVersion(ctx, id, fd.get("file") as File | null), `/diagrams/${id}`));
export const deleteDiagramAction = async (id: string, _: ActionState) => run(async (ctx) => (await deleteDiagram(ctx, id), "/diagrams"));
export const linkDiagramAssetAction = async (id: string, _: ActionState, fd: FormData) => run(async (ctx) => (await linkDiagramAsset(ctx, id, String(fd.get("assetId") ?? "")), `/diagrams/${id}`));
export const unlinkDiagramAssetAction = async (id: string, assetId: string, _: ActionState) => run(async (ctx) => (await linkDiagramAsset(ctx, id, assetId, true), `/diagrams/${id}`));
