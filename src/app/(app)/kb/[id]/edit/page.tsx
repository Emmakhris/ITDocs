import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { getArticle } from "@/server/modules/kb";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { ArticleEditor } from "../../editor";
import { saveArticleAction } from "../../actions";

export const metadata = { title: "Edit article" };

export default async function EditArticle({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "kb", "write");
  const { id } = await params;
  const [a, categories] = await Promise.all([
    getArticle(ctx, id).catch((e) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
    db.kbCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <PageHeader crumbs={[{ href: "/kb", label: "Knowledge base" }, { href: `/kb/${a.id}`, label: a.title }]} title={`Edit ${a.isTemplate ? "template" : "article"}`} subtitle={`Editing version ${a.version}. Saving creates version ${a.version + 1} if the text changed.`} />
      <ArticleEditor
        action={saveArticleAction.bind(null, a.id)}
        categories={categories}
        cancelHref={`/kb/${a.id}`}
        editing
        values={{ title: a.title, body: a.body, tags: a.tags, status: a.status, categoryId: a.categoryId, reviewEveryDays: a.reviewEveryDays, version: a.version, isTemplate: a.isTemplate }}
      />
    </>
  );
}
