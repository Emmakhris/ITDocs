import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/session";
import { db } from "@/server/db";
import { readAttachment } from "@/server/modules/kb";
import { readContractFile } from "@/server/modules/vendors";
import { AppError, NotFoundError } from "@/server/lib/errors";
import type { Ctx } from "@/server/context";

// Each attachment type is read through its own module, which checks the reader may see the record.
const readers: Record<string, (ctx: Ctx, id: string) => ReturnType<typeof readAttachment>> = {
  Article: readAttachment,
  Contract: readContractFile,
};

/** Downloads an attachment. Always served as a download, never rendered inline. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = (await params).id;
    const kind = (await db.attachment.findUnique({ where: { id }, select: { entityType: true } }))?.entityType;
    const read = kind ? readers[kind] : undefined;
    if (!read) throw new NotFoundError("File");
    const { att, data } = await read(ctx, id);
    const ascii = att.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return NextResponse.json({ error: "File is missing from storage" }, { status: 410 });
    throw e;
  }
}
