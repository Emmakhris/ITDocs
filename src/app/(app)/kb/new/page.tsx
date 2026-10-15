import Link from "next/link";
import { FileText } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { db } from "@/server/db";
import { templateOptions } from "@/server/modules/kb";
import { excerpt } from "@/lib/markdown";
import { PageHeader } from "@/components/ui";
import { ArticleEditor } from "../editor";
import { saveArticleAction } from "../actions";

export const metadata = { title: "New article" };

export default async function NewArticle({ searchParams }: { searchParams: Promise<{ template?: string; kind?: string; categoryId?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "kb", "write");
  const sp = await searchParams;
  const [templates, categories] = await Promise.all([templateOptions(ctx), db.kbCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const asTemplate = sp.kind === "template";

  if (!sp.template) {
    return (
      <>
        <PageHeader crumbs={[{ href: "/kb", label: "Knowledge base" }]} title="New article" subtitle="Start from a template, or a blank page." />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TemplateCard href="/kb/new?template=blank" title="Blank article" text="Start from an empty page." />
          {templates.map((t) => (
            <TemplateCard key={t.id} href={`/kb/new?template=${t.id}`} title={t.title} text={excerpt(t.body, 120)} />
          ))}
        </ul>
      </>
    );
  }

  const tpl = templates.find((t) => t.id === sp.template);
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/kb", label: "Knowledge base" }, ...(asTemplate ? [] : [{ href: "/kb/new", label: "New" }])]}
        title={asTemplate ? "New template" : tpl ? `New article from “${tpl.title}”` : "New article"}
        subtitle={asTemplate ? "Templates appear as starting points when someone creates an article." : undefined}
      />
      <ArticleEditor
        action={saveArticleAction.bind(null, null)}
        categories={categories}
        cancelHref={asTemplate ? "/kb?view=templates" : "/kb"}
        editing={false}
        values={{
          title: "",
          body: tpl?.body ?? "",
          tags: tpl?.tags,
          categoryId: sp.categoryId ?? tpl?.categoryId,
          status: "DRAFT",
          isTemplate: asTemplate,
        }}
      />
    </>
  );
}

function TemplateCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <li>
      <Link href={href} className="flex h-full gap-3 rounded-lg border border-line bg-surface p-4 hover:border-brand hover:bg-brand-soft/40">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <span className="min-w-0">
          <span className="block font-medium">{title}</span>
          <span className="mt-1 line-clamp-3 block text-sm text-muted">{text}</span>
        </span>
      </Link>
    </li>
  );
}
