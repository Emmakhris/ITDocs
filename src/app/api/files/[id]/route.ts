import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/session";
import { db } from "@/server/db";
import { readAttachment } from "@/server/modules/kb";
import { readContractFile } from "@/server/modules/vendors";
import { readDiagramFile } from "@/server/modules/diagrams";
import { sniffFile } from "@/server/lib/filetype";
import { AppError, NotFoundError } from "@/server/lib/errors";
import type { Ctx } from "@/server/context";

// Each attachment type is read through its own module, which checks the reader may see the record.
const readers: Record<string, (ctx: Ctx, id: string) => ReturnType<typeof readAttachment>> = {
  Article: readAttachment,
  Contract: readContractFile,
  Diagram: readDiagramFile,
};

/**
 * Downloads an attachment. Files are always served as downloads. The one exception: with
 * ?view=1, a diagram whose *content* is a raster image is served inline with its real image type
 * so the page can show it. SVG keeps the download disposition and a sandbox CSP — an <img> tag
 * still renders it (scripts never run in <img>), but opening the URL directly downloads it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const id = (await params).id;
    const kind = (await db.attachment.findUnique({ where: { id }, select: { entityType: true } }))?.entityType;
    const read = kind ? readers[kind] : undefined;
    if (!read) throw new NotFoundError("File");
    const { att, data } = await read(ctx, id);
    const ascii = att.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const view = kind === "Diagram" && new URL(req.url).searchParams.get("view") === "1";
    const sniffed = view ? sniffFile(new Uint8Array(data.subarray(0, 4096)), att.fileName) : null;
    const inlineImage = sniffed?.kind === "image";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": inlineImage || sniffed?.kind === "svg" ? sniffed!.mime : "application/octet-stream",
        "Content-Disposition": `${inlineImage ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return NextResponse.json({ error: "File is missing from storage" }, { status: 410 });
    throw e;
  }
}
