import Link from "next/link";
import type { ArticleStatus } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { kbSidebar, listArticles } from "@/server/modules/kb";
import { excerpt } from "@/lib/markdown";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Pagination, cx, fmtDate } from "@/components/ui";
import { deleteCategoryAction, saveCategoryAction } from "./actions";
import { STATUS } from "./labels";

export const metadata = { title: "Knowledge base" };

type Search = { q?: string; categoryId?: string; tag?: string; status?: string; view?: string; page?: string };

export default async function KbPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const writable = can(ctx.user.role, "kb", "write");
  const templates = sp.view === "templates" && writable;
  const status = sp.status && sp.status in STATUS ? (sp.status as ArticleStatus) : undefined;
  const [list, side] = await Promise.all([
    listArticles(ctx, { q: sp.q, categoryId: sp.categoryId, tag: sp.tag, status, templates, reviewDue: sp.view === "review", page: Number(sp.page) || 1 }),
    kbSidebar(ctx),
  ]);
  const qs = (patch: Partial<Search>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, page: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/kb${p.size ? `?${p}` : ""}`;
  };
  const currentCategory = side.categories.find((c) => c.id === sp.categoryId);
  const now = Date.now();
  const filtered = !!(sp.q || sp.categoryId || sp.tag || sp.status || sp.view);

  return (
    <>
      <PageHeader
        title="Knowledge base"
        subtitle="SOPs, runbooks and how-tos. Every save is versioned."
        actions={
          writable && (
            <>
              <LinkButton href="/kb/new?template=blank&kind=template">New template</LinkButton>
              <LinkButton href="/kb/new" variant="primary">New article</LinkButton>
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <Card title="Browse">
            <ul className="space-y-0.5 text-sm">
              <SideLink href="/kb" active={!filtered} label="All articles" />
              <SideLink href="/kb?view=review" active={sp.view === "review"} label="Due for review" count={side.reviewDue} tone={side.reviewDue ? "amber" : undefined} />
              {writable && <SideLink href="/kb?status=DRAFT" active={sp.status === "DRAFT" && !sp.categoryId} label="Drafts" />}
              <SideLink href="/kb?status=ARCHIVED" active={sp.status === "ARCHIVED" && !sp.categoryId} label="Archived" />
              {writable && <SideLink href="/kb?view=templates" active={templates} label="Templates" count={side.templates} />}
            </ul>
          </Card>
          <Card title="Categories">
            <ul className="space-y-0.5 text-sm">
              {side.categories.map((c) => (
                <SideLink key={c.id} href={`/kb?categoryId=${c.id}`} active={sp.categoryId === c.id} label={c.name} count={c._count.articles} />
              ))}
              {side.uncategorised > 0 && <SideLink href="/kb?categoryId=none" active={sp.categoryId === "none"} label="Uncategorised" count={side.uncategorised} />}
            </ul>
            {writable && (
              <details className="mt-3 border-t border-line pt-3">
                <summary className="cursor-pointer text-xs font-medium text-brand">Add category</summary>
                <ActionForm action={saveCategoryAction.bind(null, null)} className="mt-2 space-y-2">
                  <Field label="Name" name="name"><Input id="cat-name" name="name" /></Field>
                  <Submit>Add</Submit>
                </ActionForm>
              </details>
            )}
          </Card>
          {side.tags.length > 0 && (
            <Card title="Tags">
              <div className="flex flex-wrap gap-1">
                {side.tags.map((t) => (
                  <Link key={t.tag} href={sp.tag === t.tag ? qs({ tag: undefined }) : qs({ tag: t.tag })} className={cx("rounded px-1.5 py-0.5 text-xs", sp.tag === t.tag ? "bg-brand text-brand-fg" : "bg-surface-2 text-muted hover:text-fg")}>
                    #{t.tag} <span className="opacity-70">{t.count}</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </aside>

        <div className="min-w-0 space-y-3">
          <form className="flex flex-wrap gap-2">
            {Object.entries(sp).filter(([k, v]) => v && k !== "q" && k !== "page").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <Input name="q" defaultValue={sp.q} placeholder="Search titles, text and tags…" className="w-72" aria-label="Search the knowledge base" />
            <Button variant="secondary">Search</Button>
            {filtered && <LinkButton href="/kb" variant="ghost">Clear</LinkButton>}
          </form>
          {(currentCategory || sp.tag) && (
            <p className="text-sm text-muted">
              {currentCategory && <>Category <strong className="text-fg">{currentCategory.name}</strong></>}
              {currentCategory && sp.tag && " · "}
              {sp.tag && <>Tag <strong className="text-fg">#{sp.tag}</strong></>}
            </p>
          )}

          {list.rows.length === 0 ? (
            <Empty title={templates ? "No templates yet" : filtered ? "Nothing matches" : "No articles yet"}>
              {writable && !filtered && <>Start from a template such as an SOP or runbook with <Link className="text-brand hover:underline" href="/kb/new">New article</Link>.</>}
            </Empty>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {list.rows.map((a) => {
                const overdue = a.reviewDueAt && a.reviewDueAt.getTime() < now;
                return (
                  <li key={a.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/kb/${a.id}`} className="font-medium text-brand hover:underline">{a.title}</Link>
                      {a.status !== "PUBLISHED" && !a.isTemplate && <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>}
                      {overdue && a.status === "PUBLISHED" && <Badge tone="amber">Review due</Badge>}
                      {a.category && <span className="text-xs text-muted">{a.category.name}</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">{excerpt(a.body) || "Empty"}</p>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>v{a.version} · {fmtDate(a.updatedAt)} by {a.updatedBy}</span>
                      {a.tags.map((t) => <Link key={t} href={qs({ tag: t })} className="hover:text-fg">#{t}</Link>)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} href={(p) => qs({ page: String(p) })} />

          {writable && currentCategory && currentCategory._count.articles === 0 && (
            <ActionForm action={deleteCategoryAction.bind(null, currentCategory.id)} className="text-right">
              <ConfirmSubmit message={`Delete the empty category "${currentCategory.name}"?`}>Delete category</ConfirmSubmit>
            </ActionForm>
          )}
        </div>
      </div>
    </>
  );
}

function SideLink({ href, label, active, count, tone }: { href: string; label: string; active: boolean; count?: number; tone?: "amber" }) {
  return (
    <li>
      <Link href={href} aria-current={active ? "page" : undefined} className={cx("flex justify-between gap-2 rounded px-2 py-1 hover:bg-surface-2", active && "bg-brand-soft text-brand")}>
        <span className="truncate">{label}</span>
        {count !== undefined && <span className={cx("text-xs", tone === "amber" ? "font-semibold text-warn" : "text-muted")}>{count}</span>}
      </Link>
    </li>
  );
}
