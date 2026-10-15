import "server-only";
import { z } from "zod";
import { ArticleStatus, Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan, can } from "../rbac/permissions";
import { AppError, FieldError, NotFoundError } from "../lib/errors";
import { checkbox, optNum, optStr } from "../lib/forms";
import { readStoredFile, removeStoredFile, storeFile } from "../lib/storage";
import type { Ctx } from "../context";

// Knowledge base: Markdown articles with full version history, templates, tags, review cycles,
// links to assets/locations and file attachments. Readers see published and archived articles;
// drafts and templates are only visible to people who can write to the KB.

const DAY = 86_400_000;
export const LINKABLE = ["Asset", "Location"] as const;
export type LinkableType = (typeof LINKABLE)[number];

const tagList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const raw = Array.isArray(v) ? v : (v ?? "").split(",");
    return [...new Set(raw.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))];
  })
  .refine((t) => t.length <= 20, "At most 20 tags")
  .refine((t) => t.every((x) => x.length <= 40 && /^[\p{L}\p{N}._-]+$/u.test(x)), "Tags may contain letters, numbers, - _ and . only");

export const articleInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  categoryId: optStr(40),
  tags: tagList,
  status: z.nativeEnum(ArticleStatus).default("DRAFT"),
  isTemplate: checkbox,
  body: z.string().max(200_000, "Article is too long (200,000 characters max)").default(""),
  ownerId: optStr(40),
  reviewEveryDays: optNum.refine((n) => n === undefined || (Number.isInteger(n) && n >= 1 && n <= 3650), "1–3650 days"),
  changeNote: optStr(300),
  /** Version the editor started from; a mismatch means someone else saved in between */
  baseVersion: optNum,
});

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: optStr(300),
});

export type KbFilter = {
  q?: string;
  categoryId?: string;
  tag?: string;
  status?: ArticleStatus;
  templates?: boolean;
  reviewDue?: boolean;
  page?: number;
  pageSize?: number;
};

/** What this user may see: writers see everything; readers only published and archived articles. */
function visible(ctx: Ctx): Prisma.ArticleWhereInput {
  assertCan(ctx.user.role, "kb", "read");
  return can(ctx.user.role, "kb", "write") ? { deletedAt: null } : { deletedAt: null, isTemplate: false, status: { not: "DRAFT" } };
}

async function loadVisible(ctx: Ctx, id: string) {
  const a = await db.article.findFirst({ where: { id, ...visible(ctx) } });
  if (!a) throw new NotFoundError("Article");
  return a;
}

const nextReview = (days: number | null | undefined, from = new Date()) => (days ? new Date(from.getTime() + days * DAY) : null);

// ───────────────────────────── Queries ─────────────────────────────

export async function listArticles(ctx: Ctx, f: KbFilter = {}) {
  // Filters go in AND so they can only narrow the visibility rule, never replace it
  const and: Prisma.ArticleWhereInput[] = [visible(ctx), { isTemplate: !!f.templates }];
  const where: Prisma.ArticleWhereInput = { AND: and };
  if (f.categoryId) and.push({ categoryId: f.categoryId === "none" ? null : f.categoryId });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.status) and.push({ status: f.status });
  else if (!f.templates) and.push({ status: { not: "ARCHIVED" } });
  if (f.reviewDue) and.push({ reviewDueAt: { lte: new Date() } });
  if (f.q?.trim()) {
    const q = f.q.trim();
    and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { tags: { has: q.toLowerCase() } }] });
  }
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(f.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    db.article.findMany({
      where,
      select: {
        id: true, title: true, status: true, tags: true, version: true, body: true, updatedAt: true, updatedBy: true, reviewDueAt: true, isTemplate: true,
        category: { select: { id: true, name: true } },
      },
      // Title matches first when searching, then most recently updated
      orderBy: f.q ? [{ title: "asc" }] : [{ updatedAt: "desc" }],
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.article.count({ where }),
  ]);
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    rows.sort((a, b) => Number(b.title.toLowerCase().includes(q)) - Number(a.title.toLowerCase().includes(q)));
  }
  return { rows, total, page, pageSize };
}

export async function kbSidebar(ctx: Ctx) {
  const where: Prisma.ArticleWhereInput = { AND: [visible(ctx), { isTemplate: false, status: { not: "ARCHIVED" } }] };
  const [categories, uncategorised, tagRows, reviewDue, templates] = await Promise.all([
    db.kbCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { articles: { where } } } } }),
    db.article.count({ where: { ...where, categoryId: null } }),
    db.$queryRaw<{ tag: string; n: bigint }[]>(Prisma.sql`
      SELECT t AS tag, count(*) AS n FROM "Article", unnest(tags) AS t
      WHERE "deletedAt" IS NULL AND "isTemplate" = false AND status = 'PUBLISHED'
      GROUP BY t ORDER BY n DESC, t LIMIT 30`),
    db.article.count({ where: { ...where, reviewDueAt: { lte: new Date() } } }),
    can(ctx.user.role, "kb", "write") ? db.article.count({ where: { deletedAt: null, isTemplate: true } }) : 0,
  ]);
  return { categories, uncategorised, tags: tagRows.map((t) => ({ tag: t.tag, count: Number(t.n) })), reviewDue, templates };
}

export async function getArticle(ctx: Ctx, id: string) {
  const a = await db.article.findFirst({
    where: { id, ...visible(ctx) },
    include: { category: true, owner: { select: { id: true, displayName: true } } },
  });
  if (!a) throw new NotFoundError("Article");
  const [attachments, links] = await Promise.all([
    db.attachment.findMany({ where: { entityType: "Article", entityId: id }, orderBy: { createdAt: "asc" } }),
    db.entityLink.findMany({ where: { fromType: "Article", fromId: id, kind: "documents" } }),
  ]);
  const assetIds = links.filter((l) => l.toType === "Asset").map((l) => l.toId);
  const locationIds = links.filter((l) => l.toType === "Location").map((l) => l.toId);
  const [assets, locations] = await Promise.all([
    can(ctx.user.role, "assets", "read") ? db.asset.findMany({ where: { id: { in: assetIds }, deletedAt: null }, select: { id: true, tag: true, name: true }, orderBy: { tag: "asc" } }) : [],
    can(ctx.user.role, "locations", "read") ? db.location.findMany({ where: { id: { in: locationIds }, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return { ...a, attachments, assets, locations };
}

export async function listVersions(ctx: Ctx, articleId: string) {
  await loadVisible(ctx, articleId);
  return db.articleVersion.findMany({
    where: { articleId },
    select: { id: true, version: true, title: true, changeNote: true, editedByName: true, createdAt: true },
    orderBy: { version: "desc" },
  });
}

export async function getVersion(ctx: Ctx, articleId: string, version: number) {
  await loadVisible(ctx, articleId);
  const v = await db.articleVersion.findUnique({ where: { articleId_version: { articleId, version } } });
  if (!v) throw new NotFoundError("Version");
  return v;
}

/** Published articles linked to an asset or location (for their detail pages). */
export async function articlesFor(ctx: Ctx, toType: LinkableType, toId: string) {
  if (!can(ctx.user.role, "kb", "read")) return [];
  const links = await db.entityLink.findMany({ where: { fromType: "Article", toType, toId, kind: "documents" }, select: { fromId: true } });
  if (!links.length) return [];
  return db.article.findMany({
    where: { id: { in: links.map((l) => l.fromId) }, ...visible(ctx) },
    select: { id: true, title: true, status: true, reviewDueAt: true },
    orderBy: { title: "asc" },
  });
}

export async function templateOptions(ctx: Ctx) {
  assertCan(ctx.user.role, "kb", "write");
  return db.article.findMany({ where: { deletedAt: null, isTemplate: true }, select: { id: true, title: true, body: true, categoryId: true, tags: true }, orderBy: { title: "asc" } });
}

export async function reviewDueCount(ctx: Ctx) {
  if (!can(ctx.user.role, "kb", "read")) return 0;
  return db.article.count({ where: { ...visible(ctx), isTemplate: false, status: "PUBLISHED", reviewDueAt: { lte: new Date() } } });
}

// ───────────────────────────── Writes ─────────────────────────────

async function checkRefs(d: { categoryId?: string; ownerId?: string }) {
  if (d.categoryId && !(await db.kbCategory.findUnique({ where: { id: d.categoryId } }))) throw new FieldError({ categoryId: "Category not found" });
  if (d.ownerId && !(await db.user.findFirst({ where: { id: d.ownerId, active: true } }))) throw new FieldError({ ownerId: "User not found" });
}

async function writeVersion(tx: Tx, ctx: Ctx, a: { id: string; version: number; title: string; body: string }, changeNote?: string | null) {
  await tx.articleVersion.create({
    data: { articleId: a.id, version: a.version, title: a.title, body: a.body, changeNote: changeNote ?? null, editedById: ctx.user.id, editedByName: ctx.user.displayName },
  });
}

export async function createArticle(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "kb", "write");
  const d = articleInput.parse(input);
  await checkRefs(d);
  return db.$transaction(async (tx) => {
    const a = await tx.article.create({
      data: {
        title: d.title,
        body: d.body,
        tags: d.tags,
        status: d.isTemplate ? "PUBLISHED" : d.status,
        isTemplate: d.isTemplate,
        categoryId: d.categoryId ?? null,
        ownerId: d.ownerId ?? ctx.user.id,
        reviewEveryDays: d.reviewEveryDays ?? null,
        reviewDueAt: nextReview(d.reviewEveryDays),
        createdBy: ctx.user.displayName,
        updatedBy: ctx.user.displayName,
      },
    });
    await writeVersion(tx, ctx, a, d.changeNote ?? "Created");
    const { body, ...meta } = a;
    await audit(tx, ctx, { action: "create", entityType: "Article", entityId: a.id, summary: `Created ${a.isTemplate ? "template" : "article"} "${a.title}"`, after: { ...meta, bodyLength: body.length } });
    return a;
  });
}

/**
 * Saves an edit. Title/body changes create a new version; metadata-only changes (status, tags,
 * category, review cycle) don't, but are audited. `baseVersion` guards against overwriting a
 * colleague's save: the update only applies if the version is still the one the editor loaded.
 */
export async function updateArticle(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "kb", "write");
  const d = articleInput.parse(input);
  await checkRefs(d);
  return db.$transaction(async (tx) => {
    const before = await tx.article.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundError("Article");
    const base = d.baseVersion ?? before.version;
    if (base !== before.version)
      throw new AppError(`${before.updatedBy} saved version ${before.version} while you were editing (you started from version ${base}). Copy your changes, reload, and apply them again.`, 409);
    const contentChanged = before.title !== d.title || before.body !== d.body;
    const cycleChanged = (before.reviewEveryDays ?? null) !== (d.reviewEveryDays ?? null);
    const data = {
      title: d.title,
      body: d.body,
      tags: d.tags,
      status: before.isTemplate ? before.status : d.status,
      categoryId: d.categoryId ?? null,
      ownerId: d.ownerId ?? before.ownerId,
      reviewEveryDays: d.reviewEveryDays ?? null,
      reviewDueAt: cycleChanged ? nextReview(d.reviewEveryDays, before.lastReviewedAt ?? new Date()) : before.reviewDueAt,
      updatedBy: ctx.user.displayName,
      version: contentChanged ? before.version + 1 : before.version,
    };
    const res = await tx.article.updateMany({ where: { id, version: base }, data });
    if (!res.count) throw new AppError("Someone else saved this article at the same moment. Reload and try again.", 409);
    const after = await tx.article.findUniqueOrThrow({ where: { id } });
    if (contentChanged) await writeVersion(tx, ctx, after, d.changeNote);
    // Audit the size change rather than whole bodies; the versions table holds the text
    const strip = ({ body, ...rest }: typeof before) => ({ ...rest, body: body === after.body ? undefined : `${body.length} chars` });
    const df = diff(strip(before), strip(after));
    if (df.changed.length)
      await audit(tx, ctx, {
        action: "update",
        entityType: "Article",
        entityId: id,
        summary: `Updated "${after.title}"${contentChanged ? ` (version ${after.version})` : ""}${d.changeNote ? `: ${d.changeNote}` : ""}`,
        before: df.before,
        after: df.after,
      });
    return after;
  });
}

export async function restoreVersion(ctx: Ctx, id: string, version: number) {
  assertCan(ctx.user.role, "kb", "write");
  const old = await getVersion(ctx, id, version);
  const current = await loadVisible(ctx, id);
  if (old.title === current.title && old.body === current.body) throw new AppError(`Version ${version} is the same as the current text.`);
  return db.$transaction(async (tx) => {
    const res = await tx.article.updateMany({
      where: { id, version: current.version },
      data: { title: old.title, body: old.body, version: current.version + 1, updatedBy: ctx.user.displayName },
    });
    if (!res.count) throw new AppError("The article changed while restoring. Reload and try again.", 409);
    const after = await tx.article.findUniqueOrThrow({ where: { id } });
    await writeVersion(tx, ctx, after, `Restored version ${version}`);
    await audit(tx, ctx, { action: "restore", entityType: "Article", entityId: id, summary: `Restored "${after.title}" to version ${version} (now version ${after.version})` });
    return after;
  });
}

export async function markReviewed(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "kb", "write");
  const a = await loadVisible(ctx, id);
  const now = new Date();
  return db.$transaction(async (tx) => {
    const after = await tx.article.update({ where: { id }, data: { lastReviewedAt: now, reviewDueAt: nextReview(a.reviewEveryDays, now) } });
    await audit(tx, ctx, { action: "review", entityType: "Article", entityId: id, summary: `Reviewed "${a.title}"${after.reviewDueAt ? `; next review ${after.reviewDueAt.toISOString().slice(0, 10)}` : ""}` });
    return after;
  });
}

export async function deleteArticle(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "kb", "write");
  const a = await loadVisible(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.article.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "delete", entityType: "Article", entityId: id, summary: `Deleted "${a.title}" (history kept)` });
  });
}

// ───────────────────────────── Categories ─────────────────────────────

export async function saveCategory(ctx: Ctx, id: string | null, input: unknown) {
  assertCan(ctx.user.role, "kb", "write");
  const d = categoryInput.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      if (!id) {
        const c = await tx.kbCategory.create({ data: { name: d.name, description: d.description ?? null } });
        await audit(tx, ctx, { action: "create", entityType: "KbCategory", entityId: c.id, summary: `Created KB category ${c.name}`, after: c });
        return c;
      }
      const before = await tx.kbCategory.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Category");
      const after = await tx.kbCategory.update({ where: { id }, data: { name: d.name, description: d.description ?? null } });
      const df = diff(before, after);
      if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "KbCategory", entityId: id, summary: `Updated KB category ${after.name}`, before: df.before, after: df.after });
      return after;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new FieldError({ name: "A category with that name exists" });
    throw e;
  }
}

export async function deleteCategory(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "kb", "write");
  const n = await db.article.count({ where: { categoryId: id, deletedAt: null } });
  if (n) throw new AppError(`Move or delete its ${n} article(s) first.`);
  await db.$transaction(async (tx) => {
    const c = await tx.kbCategory.delete({ where: { id } });
    await audit(tx, ctx, { action: "delete", entityType: "KbCategory", entityId: id, summary: `Deleted KB category ${c.name}` });
  });
}

// ───────────────────────────── Links ─────────────────────────────

export async function linkArticle(ctx: Ctx, articleId: string, toType: string, toId: string) {
  assertCan(ctx.user.role, "kb", "write");
  if (!LINKABLE.includes(toType as LinkableType)) throw new AppError("Unsupported link target.");
  const a = await loadVisible(ctx, articleId);
  const target =
    toType === "Asset"
      ? await db.asset.findFirst({ where: { id: toId, deletedAt: null }, select: { tag: true } }).then((x) => x?.tag)
      : await db.location.findFirst({ where: { id: toId, deletedAt: null }, select: { name: true } }).then((x) => x?.name);
  if (!target) throw new FieldError({ toId: `${toType} not found` });
  await db.$transaction(async (tx) => {
    const key = { fromType: "Article", fromId: articleId, toType, toId, kind: "documents" };
    if (await tx.entityLink.findUnique({ where: { fromType_fromId_toType_toId_kind: key } })) return;
    await tx.entityLink.create({ data: key });
    await audit(tx, ctx, { action: "link", entityType: "Article", entityId: articleId, summary: `Linked "${a.title}" to ${toType.toLowerCase()} ${target}` });
  });
}

export async function unlinkArticle(ctx: Ctx, articleId: string, toType: string, toId: string) {
  assertCan(ctx.user.role, "kb", "write");
  const a = await loadVisible(ctx, articleId);
  await db.$transaction(async (tx) => {
    const r = await tx.entityLink.deleteMany({ where: { fromType: "Article", fromId: articleId, toType, toId, kind: "documents" } });
    if (r.count) await audit(tx, ctx, { action: "unlink", entityType: "Article", entityId: articleId, summary: `Unlinked "${a.title}" from ${toType.toLowerCase()} ${toId}` });
  });
}

// ───────────────────────────── Attachments ─────────────────────────────

export async function addAttachment(ctx: Ctx, articleId: string, file: File | null | undefined) {
  assertCan(ctx.user.role, "kb", "write");
  const a = await loadVisible(ctx, articleId);
  const stored = await storeFile("kb", file);
  try {
    return await db.$transaction(async (tx) => {
      const att = await tx.attachment.create({ data: { ...stored, entityType: "Article", entityId: articleId, uploadedBy: ctx.user.displayName } });
      await audit(tx, ctx, { action: "attach", entityType: "Article", entityId: articleId, summary: `Attached ${att.fileName} (${Math.ceil(att.size / 1024)} KB) to "${a.title}"` });
      return att;
    });
  } catch (e) {
    await removeStoredFile(stored.storageKey);
    throw e;
  }
}

/** For the download route: checks the reader may see the article the file belongs to. */
export async function readAttachment(ctx: Ctx, id: string) {
  const att = await db.attachment.findUnique({ where: { id } });
  if (!att || att.entityType !== "Article") throw new NotFoundError("File");
  await loadVisible(ctx, att.entityId);
  return { att, data: await readStoredFile(att.storageKey) };
}

export async function removeAttachment(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "kb", "write");
  const att = await db.attachment.findUnique({ where: { id } });
  if (!att || att.entityType !== "Article") throw new NotFoundError("File");
  await db.$transaction(async (tx) => {
    await tx.attachment.delete({ where: { id } });
    await audit(tx, ctx, { action: "detach", entityType: "Article", entityId: att.entityId, summary: `Removed attachment ${att.fileName}` });
  });
  await removeStoredFile(att.storageKey);
  return att.entityId;
}
