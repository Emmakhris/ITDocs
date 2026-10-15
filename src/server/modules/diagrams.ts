import "server-only";
import { z } from "zod";
import { DiagramKind, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { FieldError, NotFoundError } from "../lib/errors";
import { optStr } from "../lib/forms";
import { DIAGRAM_KINDS, sniffFile } from "../lib/filetype";
import { MAX_ATTACHMENT_BYTES, readStoredFile, removeStoredFile, storeFile } from "../lib/storage";
import type { Ctx } from "../context";

// Network / floor / rack diagrams: uploaded images, PDFs, SVG, draw.io or Visio files, linked to a
// location and to the assets they show. Re-uploading keeps earlier versions. Uses the "network"
// permission. The file type is detected from its content, never from its name.

export const diagramInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  description: optStr(4000),
  kind: z.nativeEnum(DiagramKind).default("NETWORK"),
  locationId: optStr(40),
});

async function checkFile(file: File | null | undefined) {
  if (!file || typeof file === "string" || !file.size) throw new FieldError({ file: "Choose a file" });
  if (file.size > MAX_ATTACHMENT_BYTES) throw new FieldError({ file: "Files can be at most 10 MB" });
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const t = sniffFile(head, file.name);
  if (!DIAGRAM_KINDS.includes(t.kind)) throw new FieldError({ file: "Upload a PNG, JPEG, GIF, WebP, SVG, PDF, draw.io or Visio file" });
  return t;
}

async function storeVersion(ctx: Ctx, diagramId: string, file: File) {
  const t = await checkFile(file);
  const stored = await storeFile("diagrams", file);
  return { ...stored, mimeType: t.mime, entityType: "Diagram", entityId: diagramId, uploadedBy: ctx.user.displayName };
}

export async function listDiagrams(ctx: Ctx, f: { q?: string; kind?: DiagramKind; locationId?: string } = {}) {
  assertCan(ctx.user.role, "network", "read");
  const where: Prisma.DiagramWhereInput = { deletedAt: null };
  if (f.kind) where.kind = f.kind;
  if (f.locationId) where.locationId = f.locationId;
  if (f.q) where.OR = [{ title: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }];
  const rows = await db.diagram.findMany({ where, include: { location: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } });
  const files = await db.attachment.findMany({ where: { entityType: "Diagram", entityId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } });
  return rows.map((d) => {
    const mine = files.filter((x) => x.entityId === d.id);
    return { ...d, file: mine[0] ?? null, versions: mine.length };
  });
}

export async function getDiagram(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "network", "read");
  const d = await db.diagram.findFirst({ where: { id, deletedAt: null }, include: { location: { select: { id: true, name: true } } } });
  if (!d) throw new NotFoundError("Diagram");
  const [files, links] = await Promise.all([
    db.attachment.findMany({ where: { entityType: "Diagram", entityId: id }, orderBy: { createdAt: "desc" } }),
    db.entityLink.findMany({ where: { fromType: "Diagram", fromId: id, toType: "Asset", kind: "depicts" }, select: { toId: true } }),
  ]);
  const assets = can(ctx.user.role, "assets", "read")
    ? await db.asset.findMany({ where: { id: { in: links.map((l) => l.toId) }, deletedAt: null }, select: { id: true, tag: true, name: true }, orderBy: { tag: "asc" } })
    : [];
  return { ...d, files, assets };
}

export async function createDiagram(ctx: Ctx, input: unknown, file: File | null) {
  assertCan(ctx.user.role, "network", "write");
  const d = diagramInput.parse(input);
  if (d.locationId && !(await db.location.findFirst({ where: { id: d.locationId, deletedAt: null } }))) throw new FieldError({ locationId: "Location not found" });
  await checkFile(file);
  const row = await db.diagram.create({ data: { title: d.title, description: d.description ?? null, kind: d.kind, locationId: d.locationId ?? null, createdBy: ctx.user.displayName } });
  let att: Awaited<ReturnType<typeof storeVersion>> | null = null;
  try {
    att = await storeVersion(ctx, row.id, file!);
    await db.$transaction(async (tx) => {
      await tx.attachment.create({ data: att! });
      await audit(tx, ctx, { action: "create", entityType: "Diagram", entityId: row.id, summary: `Added diagram "${row.title}" (${att!.fileName})` });
    });
    return row;
  } catch (e) {
    if (att) await removeStoredFile(att.storageKey);
    await db.diagram.delete({ where: { id: row.id } });
    throw e;
  }
}

export async function updateDiagram(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "network", "write");
  const d = diagramInput.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.diagram.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError("Diagram");
    const after = await tx.diagram.update({ where: { id }, data: { title: d.title, description: d.description ?? null, kind: d.kind, locationId: d.locationId ?? null } });
    const df = diff(before, after);
    if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "Diagram", entityId: id, summary: `Updated diagram "${after.title}"`, before: df.before, after: df.after });
    return after;
  });
}

export async function uploadDiagramVersion(ctx: Ctx, id: string, file: File | null) {
  assertCan(ctx.user.role, "network", "write");
  const d = await db.diagram.findFirst({ where: { id, deletedAt: null } });
  if (!d) throw new NotFoundError("Diagram");
  await checkFile(file);
  const att = await storeVersion(ctx, id, file!);
  try {
    await db.$transaction(async (tx) => {
      await tx.attachment.create({ data: att });
      await tx.diagram.update({ where: { id }, data: { updatedAt: new Date() } });
      await audit(tx, ctx, { action: "attach", entityType: "Diagram", entityId: id, summary: `Uploaded a new version of "${d.title}" (${att.fileName})` });
    });
  } catch (e) {
    await removeStoredFile(att.storageKey);
    throw e;
  }
}

export async function deleteDiagram(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "network", "write");
  await db.$transaction(async (tx) => {
    const d = await tx.diagram.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw new NotFoundError("Diagram");
    await tx.diagram.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "delete", entityType: "Diagram", entityId: id, summary: `Deleted diagram "${d.title}" (files kept)` });
  });
}

export async function linkDiagramAsset(ctx: Ctx, id: string, assetId: string, unlink = false) {
  assertCan(ctx.user.role, "network", "write");
  const d = await db.diagram.findFirst({ where: { id, deletedAt: null }, select: { title: true } });
  if (!d) throw new NotFoundError("Diagram");
  const key = { fromType: "Diagram", fromId: id, toType: "Asset", toId: assetId, kind: "depicts" };
  await db.$transaction(async (tx) => {
    if (unlink) {
      const r = await tx.entityLink.deleteMany({ where: key });
      if (r.count) await audit(tx, ctx, { action: "unlink", entityType: "Diagram", entityId: id, summary: `Removed asset ${assetId} from "${d.title}"` });
      return;
    }
    const a = await tx.asset.findFirst({ where: { id: assetId, deletedAt: null }, select: { tag: true } });
    if (!a) throw new FieldError({ assetId: "Asset not found" });
    if (await tx.entityLink.findUnique({ where: { fromType_fromId_toType_toId_kind: key } })) return;
    await tx.entityLink.create({ data: key });
    await audit(tx, ctx, { action: "link", entityType: "Diagram", entityId: id, summary: `"${d.title}" shows ${a.tag}` });
  });
}

/** Diagrams for a location or asset page. */
export async function diagramsFor(ctx: Ctx, where: { locationId: string } | { assetId: string }) {
  if (!can(ctx.user.role, "network", "read")) return [];
  const ids =
    "assetId" in where
      ? (await db.entityLink.findMany({ where: { fromType: "Diagram", toType: "Asset", toId: where.assetId, kind: "depicts" }, select: { fromId: true } })).map((l) => l.fromId)
      : undefined;
  return db.diagram.findMany({
    where: { deletedAt: null, ...("locationId" in where ? { locationId: where.locationId } : { id: { in: ids } }) },
    select: { id: true, title: true, kind: true },
    orderBy: { title: "asc" },
  });
}

/** For the file route: the stored file with its detected type (used to show images inline). */
export async function readDiagramFile(ctx: Ctx, attachmentId: string) {
  assertCan(ctx.user.role, "network", "read");
  const att = await db.attachment.findUnique({ where: { id: attachmentId } });
  if (!att || att.entityType !== "Diagram") throw new NotFoundError("File");
  if (!(await db.diagram.findFirst({ where: { id: att.entityId, deletedAt: null } }))) throw new NotFoundError("File");
  return { att, data: await readStoredFile(att.storageKey) };
}
