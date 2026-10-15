import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import {
  addAttachment,
  articlesFor,
  createArticle,
  deleteArticle,
  getArticle,
  linkArticle,
  listArticles,
  listVersions,
  markReviewed,
  readAttachment,
  removeAttachment,
  restoreVersion,
  reviewDueCount,
  safeFileName,
  saveCategory,
  updateArticle,
} from "@/server/modules/kb";
import { globalSearch } from "@/server/modules/search";
import { AppError, FieldError, ForbiddenError, NotFoundError } from "@/server/lib/errors";

const run = Date.now().toString(36);
const mkUser = async (role: "ADMIN" | "TECHNICIAN" | "READONLY" | "AUDITOR", name: string): Promise<Ctx> => {
  const u = await db.user.create({ data: { username: `k-${name}-${run}`, displayName: `${name} ${run}`, role, source: "LOCAL" } });
  return { user: { id: u.id, username: u.username, displayName: u.displayName, role } };
};

let tech: Ctx, tech2: Ctx, viewer: Ctx, auditor: Ctx;
beforeAll(async () => {
  [tech, tech2, viewer, auditor] = await Promise.all([mkUser("TECHNICIAN", "tech"), mkUser("TECHNICIAN", "tech2"), mkUser("READONLY", "viewer"), mkUser("AUDITOR", "auditor")]);
});

describe("articles and versions", () => {
  it("creates version 1, normalises tags and writes an audit entry", async () => {
    const a = await createArticle(tech, { title: `Downtime ${run}`, body: "# Steps\n1. Call", tags: "EHR, Downtime Procedure,ehr", status: "PUBLISHED" });
    expect(a.version).toBe(1);
    expect(a.tags).toEqual(["ehr", "downtime-procedure"]);
    expect(await db.articleVersion.count({ where: { articleId: a.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityType: "Article", entityId: a.id, action: "create" } })).toBe(1);
  });

  it("bumps the version on text changes only, and refuses stale edits", async () => {
    const a = await createArticle(tech, { title: `Runbook ${run}`, body: "v1", status: "PUBLISHED" });
    const v2 = await updateArticle(tech, a.id, { title: a.title, body: "v2", status: "PUBLISHED", baseVersion: 1, changeNote: "second" });
    expect(v2.version).toBe(2);
    const meta = await updateArticle(tech, a.id, { title: a.title, body: "v2", status: "PUBLISHED", tags: "dns", baseVersion: 2 });
    expect(meta.version).toBe(2); // tags only: no new version, but audited
    expect(await db.auditLog.count({ where: { entityId: a.id, action: "update" } })).toBe(2);

    // tech2 still has version 1 open
    const stale = await updateArticle(tech2, a.id, { title: a.title, body: "overwrite!", status: "PUBLISHED", baseVersion: 1 }).catch((e) => e);
    expect(stale).toBeInstanceOf(AppError);
    expect((stale as AppError).status).toBe(409);
    expect((await db.article.findUnique({ where: { id: a.id } }))?.body).toBe("v2");

    // Two editors saving the same base version at once: exactly one wins
    const results = await Promise.allSettled([
      updateArticle(tech, a.id, { title: a.title, body: "from tech", status: "PUBLISHED", baseVersion: 2 }),
      updateArticle(tech2, a.id, { title: a.title, body: "from tech2", status: "PUBLISHED", baseVersion: 2 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await listVersions(tech, a.id)).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("restores an old version as a new version, and history can't be altered", async () => {
    const a = await createArticle(tech, { title: `Restore ${run}`, body: "original", status: "PUBLISHED" });
    await updateArticle(tech, a.id, { title: a.title, body: "broken edit", status: "PUBLISHED", baseVersion: 1 });
    const r = await restoreVersion(tech, a.id, 1);
    expect([r.version, r.body]).toEqual([3, "original"]);
    expect((await listVersions(tech, a.id))[0].changeNote).toBe("Restored version 1");
    await expect(restoreVersion(tech, a.id, 1)).rejects.toThrow(/same as the current/);
    await expect(db.articleVersion.updateMany({ where: { articleId: a.id }, data: { body: "tampered" } })).rejects.toThrow();
    await expect(db.articleVersion.deleteMany({ where: { articleId: a.id } })).rejects.toThrow();
  });

  it("schedules and records reviews", async () => {
    const a = await createArticle(tech, { title: `Review ${run}`, body: "x", status: "PUBLISHED", reviewEveryDays: 90 });
    expect(Math.round((a.reviewDueAt!.getTime() - Date.now()) / 86_400_000)).toBe(90);
    await db.article.update({ where: { id: a.id }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
    expect((await listArticles(viewer, { reviewDue: true })).rows.some((r) => r.id === a.id)).toBe(true);
    const before = await reviewDueCount(viewer);
    await markReviewed(tech, a.id);
    expect(await reviewDueCount(viewer)).toBe(before - 1);
    expect(await db.auditLog.count({ where: { entityId: a.id, action: "review" } })).toBe(1);
  });
});

describe("visibility and RBAC", () => {
  it("hides drafts and templates from readers and blocks their writes", async () => {
    const draft = await createArticle(tech, { title: `Draft ${run}`, body: "secret plan", status: "DRAFT" });
    const tpl = await createArticle(tech, { title: `Template ${run}`, body: "## Purpose", isTemplate: "on" });
    await expect(getArticle(viewer, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getArticle(auditor, tpl.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getArticle(tech2, draft.id)).title).toBe(draft.title);
    expect((await listArticles(viewer, { q: run })).rows.map((r) => r.id)).not.toContain(draft.id);
    expect((await globalSearch(viewer, `Draft ${run}`)).some((h) => h.id === draft.id)).toBe(false);
    expect((await globalSearch(tech, `Draft ${run}`)).some((h) => h.kind === "Article")).toBe(true);

    await expect(createArticle(viewer, { title: "x", body: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateArticle(auditor, draft.id, { title: "x", body: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteArticle(viewer, draft.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveCategory(viewer, null, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.auditLog.count({ where: { actorId: { in: [viewer.user.id, auditor.user.id] } } })).toBe(0);
  });

  it("soft-deletes, keeping history", async () => {
    const a = await createArticle(tech, { title: `Delete ${run}`, body: "x", status: "PUBLISHED" });
    await deleteArticle(tech, a.id);
    await expect(getArticle(tech, a.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.articleVersion.count({ where: { articleId: a.id } })).toBe(1);
  });
});

describe("links and attachments", () => {
  it("links articles to assets and shows them on the asset", async () => {
    const type = await db.assetType.upsert({ where: { name: "KB test type" }, create: { name: "KB test type" }, update: {} });
    const asset = await db.asset.create({ data: { tag: `KB-${run}`, name: "Zebra printer", typeId: type.id } });
    const a = await createArticle(tech, { title: `Clear jam ${run}`, body: "x", status: "PUBLISHED" });
    await linkArticle(tech, a.id, "Asset", asset.id);
    await linkArticle(tech, a.id, "Asset", asset.id); // idempotent
    expect((await articlesFor(viewer, "Asset", asset.id)).map((x) => x.id)).toEqual([a.id]);
    expect((await getArticle(viewer, a.id)).assets.map((x) => x.tag)).toEqual([asset.tag]);
    expect(await db.auditLog.count({ where: { entityId: a.id, action: "link" } })).toBe(1);
    await expect(linkArticle(tech, a.id, "Asset", "nope")).rejects.toBeInstanceOf(FieldError);
    await expect(linkArticle(tech, a.id, "User", tech.user.id)).rejects.toThrow(/Unsupported/);
  });

  it("stores attachments outside the database, checks access on download, and cleans up", async () => {
    const a = await createArticle(tech, { title: `Files ${run}`, body: "x", status: "DRAFT" });
    const att = await addAttachment(tech, a.id, new File(["hello"], "../../etc/passwd\u0007.txt", { type: "text/plain" }));
    expect(att.fileName).toBe("passwd_.txt");
    expect(att.storageKey).toMatch(/^kb\/[a-f0-9]{32}$/);
    expect((await readAttachment(tech2, att.id)).data.toString()).toBe("hello");
    await expect(readAttachment(viewer, att.id)).rejects.toBeInstanceOf(NotFoundError); // draft article
    await expect(addAttachment(tech, a.id, new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.bin"))).rejects.toBeInstanceOf(FieldError);
    await removeAttachment(tech, att.id);
    await expect(readAttachment(tech, att.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(safeFileName("..\\..\\boot.ini")).toBe("boot.ini");
  });
});
