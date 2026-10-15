import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getArticle } from "@/server/modules/kb";
import { locationTree } from "@/server/modules/locations";
import { NotFoundError } from "@/server/lib/errors";
import { db } from "@/server/db";
import { outline, renderMarkdown } from "@/lib/markdown";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { LocationSelect, RemotePicker } from "@/components/pickers";
import { Badge, Card, DL, LinkButton, PageHeader, fmtDate, fmtDateTime } from "@/components/ui";
import { attachAction, deleteArticleAction, detachAction, linkAction, reviewedAction, unlinkAction } from "../actions";
import { STATUS } from "../labels";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const a = await db.article.findUnique({ where: { id: (await params).id }, select: { title: true } });
  return { title: a?.title ?? "Article" };
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.ceil(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const a = await getArticle(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "kb", "write");
  const locations = writable ? await locationTree() : [];
  const toc = outline(a.body).filter((h) => h.level <= 3);
  const overdue = a.reviewDueAt && a.reviewDueAt.getTime() < Date.now();

  return (
    <>
      <PageHeader
        crumbs={[{ href: a.isTemplate ? "/kb?view=templates" : "/kb", label: a.isTemplate ? "Templates" : "Knowledge base" }, ...(a.category ? [{ href: `/kb?categoryId=${a.category.id}`, label: a.category.name }] : [])]}
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {a.isTemplate ? <Badge tone="blue">Template</Badge> : <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>}
            {overdue && !a.isTemplate && <Badge tone="amber">Review due {fmtDate(a.reviewDueAt)}</Badge>}
            <span>Version {a.version} · updated {fmtDateTime(a.updatedAt)} by {a.updatedBy}</span>
            {a.tags.map((t) => <Link key={t} href={`/kb?tag=${encodeURIComponent(t)}`} className="text-xs hover:text-fg">#{t}</Link>)}
          </span>
        }
        actions={
          <>
            <LinkButton href={`/kb/${a.id}/history`}>History</LinkButton>
            {a.isTemplate && writable && <LinkButton href={`/kb/new?template=${a.id}`}>Use template</LinkButton>}
            {writable && <LinkButton href={`/kb/${a.id}/edit`} variant="primary">Edit</LinkButton>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="min-w-0 rounded-lg border border-line bg-surface p-5 sm:p-6">
          {a.body.trim() ? <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body) }} /> : <p className="text-sm text-muted">This article is empty.</p>}
        </article>

        <aside className="space-y-4">
          {toc.length > 2 && (
            <Card title="On this page">
              <ul className="space-y-1 text-sm">
                {toc.map((h) => (
                  <li key={h.id} style={{ paddingLeft: (h.level - 1) * 10 }}>
                    <a href={`#${h.id}`} className="text-muted hover:text-fg">{h.text}</a>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Details">
            <DL
              items={[
                ["Owner", a.owner?.displayName],
                ["Created", `${fmtDate(a.createdAt)} by ${a.createdBy}`],
                ...(!a.isTemplate
                  ? ([
                      ["Review cycle", a.reviewEveryDays ? `Every ${a.reviewEveryDays} days` : "None"],
                      ["Last reviewed", fmtDate(a.lastReviewedAt)],
                      ["Next review", a.reviewDueAt && <span className={overdue ? "font-medium text-warn" : undefined}>{fmtDate(a.reviewDueAt)}</span>],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {writable && a.reviewEveryDays && !a.isTemplate && (
              <ActionForm action={reviewedAction.bind(null, a.id)} className="mt-3 border-t border-line pt-3">
                <ConfirmSubmit variant="secondary" message="Confirm you have checked this article is still accurate?">Mark as reviewed</ConfirmSubmit>
              </ActionForm>
            )}
          </Card>

          {!a.isTemplate && (
            <Card title="Applies to">
              {a.assets.length + a.locations.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {a.assets.map((x) => (
                    <LinkedRow key={x.id} href={`/assets/${x.id}`} label={<><span className="font-mono">{x.tag}</span> {x.name}</>} unlink={writable ? unlinkAction.bind(null, a.id, "Asset", x.id) : undefined} />
                  ))}
                  {a.locations.map((x) => (
                    <LinkedRow key={x.id} href={`/locations/${x.id}`} label={x.name} unlink={writable ? unlinkAction.bind(null, a.id, "Location", x.id) : undefined} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Not linked to any device or location.</p>
              )}
              {writable && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <ActionForm action={linkAction.bind(null, a.id)} className="space-y-2">
                    <input type="hidden" name="toType" value="Asset" />
                    <Field label="Link an asset" name="toId"><RemotePicker name="assetId" kind="assets" /></Field>
                    <Submit variant="secondary">Link asset</Submit>
                  </ActionForm>
                  <ActionForm action={linkAction.bind(null, a.id)} className="space-y-2">
                    <input type="hidden" name="toType" value="Location" />
                    <Field label="Link a location" name="toId"><LocationSelect id="locationId" name="locationId" locations={locations} emptyLabel="— Choose —" /></Field>
                    <Submit variant="secondary">Link location</Submit>
                  </ActionForm>
                </div>
              )}
            </Card>
          )}

          <Card title={`Attachments (${a.attachments.length})`}>
            {a.attachments.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {a.attachments.map((f) => (
                  <li key={f.id} className="flex items-start gap-2">
                    <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <a href={`/api/kb/files/${f.id}`} className="break-all text-brand hover:underline">{f.fileName}</a>
                      <span className="block text-xs text-muted">{size(f.size)} · {f.uploadedBy}</span>
                    </span>
                    {writable && (
                      <ActionForm action={detachAction.bind(null, f.id)}>
                        <ConfirmSubmit message={`Remove ${f.fileName}?`}>✕</ConfirmSubmit>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No files attached.</p>
            )}
            {writable && (
              <ActionForm action={attachAction.bind(null, a.id)} className="mt-3 space-y-2 border-t border-line pt-3" resetOnSuccess>
                <Field label="Attach a file" name="file" hint="Up to 10 MB. Files always download; they never open in the browser.">
                  <input id="file" name="file" type="file" className="block w-full text-xs file:mr-2 file:rounded file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-xs" />
                </Field>
                <Submit variant="secondary">Upload</Submit>
              </ActionForm>
            )}
          </Card>

          {writable && (
            <ActionForm action={deleteArticleAction.bind(null, a.id)} className="text-right">
              <ConfirmSubmit message={`Delete "${a.title}"? It disappears from the knowledge base; its version history and audit entries are kept.`}>Delete article</ConfirmSubmit>
            </ActionForm>
          )}
        </aside>
      </div>
    </>
  );
}

function LinkedRow({ href, label, unlink }: { href: string; label: React.ReactNode; unlink?: Parameters<typeof ActionForm>[0]["action"] }) {
  return (
    <li className="flex items-center gap-2">
      <Link href={href} className="min-w-0 flex-1 truncate text-brand hover:underline">{label}</Link>
      {unlink && (
        <ActionForm action={unlink}>
          <ConfirmSubmit variant="secondary" message="Remove this link?">Unlink</ConfirmSubmit>
        </ActionForm>
      )}
    </li>
  );
}
