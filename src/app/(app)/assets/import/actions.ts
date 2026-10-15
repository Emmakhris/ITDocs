"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/session";
import { importAssets, type ImportResult, type ImportRow } from "@/server/modules/asset-import";
import { AppError } from "@/server/lib/errors";

export async function runImport(rows: ImportRow[], dryRun: boolean): Promise<ImportResult | { fatal: string }> {
  try {
    const ctx = await requireCtx();
    const r = await importAssets(ctx, rows, dryRun);
    if (!dryRun) revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { fatal: e instanceof AppError ? e.message : "Import failed. Check the server log." };
  }
}
