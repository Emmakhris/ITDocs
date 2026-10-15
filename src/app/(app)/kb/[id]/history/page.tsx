import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getArticle, getVersion, listVersions } from "@/server/modules/kb";
import { NotFoundError } from "@/server/lib/errors";
import { renderMarkdown } from "@/lib/markdown";
import { diffLines, diffStats } from "@/lib/text-diff";
import { ActionForm, ConfirmSubmit } from "@/components/form";
import { Card, PageHeader, cx, fmtDateTime } from "@/components/ui";
import { restoreAction } from "../../actions";

export const metadata = { title: "Article history" };

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; v?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const nf = (e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  };
  const [article, versions] = await Promise.all([getArticle(ctx, id).catch(nf), listVersions(ctx, id).catch(nf)]);
  const writable = can(ctx.user.role, "kb", "write");
  const latest = versions[0]?.version ?? 1;

  // Either view one version (?v=) or compare two (?a=&b=, default: previous vs latest)
  const view = sp.v ? await getVersion(ctx, id, Number(sp.v)).catch(nf) : null;
  const b = Number(sp.b) || latest;
  const a = Number(sp.a) || b - 1;
  const compare = !view && a >= 1 && a !== b ? await Promise.all([getVersion(ctx, id, a), getVersion(ctx, id, b)]).catch(nf) : null;
  const lines = compare ? diffLines(compare[0].body, compare[1].body) : [];
  const stats = diffStats(lines);
  const href = (q: string) => `/kb/${id}/history?${q}`;

  return (
    <>
      <PageHeader crumbs={[{ href: "/kb", label: "Knowledge base" }, { href: `/kb/${id}`, label: article.title }]} title="Version history" subtitle={`${versions.length} version${versions.length === 1 ? "" : "s"}. Old versions can't be changed or deleted.`} />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Versions">
          <ol className="divide-y divide-line text-sm">
            {versions.map((v) => {
              const selected = view ? view.version === v.version : compare && (v.version === a || v.version === b);
              return (
                <li key={v.id} className={cx("py-2", selected && "-mx-2 rounded bg-brand-soft/60 px-2")}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">v{v.version}{v.version === latest && <span className="ml-1 text-xs font-normal text-muted">(current)</span>}</span>
                    <span className="text-xs text-muted">{fmtDateTime(v.createdAt)}</span>
                  </div>
                  <p className="text-xs text-muted">{v.editedByName}{v.changeNote && <> — {v.changeNote}</>}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    <Link href={href(`v=${v.version}`)} className="text-brand hover:underline">View</Link>
                    {v.version > 1 && <Link href={href(`a=${v.version - 1}&b=${v.version}`)} className="text-brand hover:underline">Changes</Link>}
                    {v.version !== latest && <Link href={href(`a=${v.version}&b=${latest}`)} className="text-brand hover:underline">Compare with current</Link>}
                  </p>
                  {writable && v.version !== latest && (
                    <ActionForm action={restoreAction.bind(null, id, v.version)} className="mt-1">
                      <ConfirmSubmit variant="secondary" message={`Restore version ${v.version}? It becomes a new version ${latest + 1}; nothing is lost.`}>Restore</ConfirmSubmit>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="min-w-0">
          {view ? (
            <Card title={`Version ${view.version}: ${view.title}`} actions={<span className="text-xs text-muted">{view.editedByName} · {fmtDateTime(view.createdAt)}</span>}>
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(view.body) }} />
            </Card>
          ) : compare ? (
            <Card
              title={<>Changes from v{compare[0].version} to v{compare[1].version}</>}
              actions={<span className="text-xs"><span className="text-ok">+{stats.added}</span> <span className="text-danger">−{stats.removed}</span></span>}
            >
              {compare[0].title !== compare[1].title && (
                <p className="mb-3 text-sm">
                  Title: <del className="text-danger">{compare[0].title}</del> → <ins className="text-ok no-underline">{compare[1].title}</ins>
                </p>
              )}
              {stats.added + stats.removed === 0 ? (
                <p className="text-sm text-muted">The text is identical.</p>
              ) : (
                <div className="overflow-x-auto rounded border border-line">
                  <table className="w-full border-collapse font-mono text-xs leading-5">
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} className={l.type === "add" ? "bg-ok-soft" : l.type === "del" ? "bg-danger-soft" : undefined}>
                          <td className="w-10 select-none border-r border-line px-2 text-right text-muted">{l.a ?? ""}</td>
                          <td className="w-10 select-none border-r border-line px-2 text-right text-muted">{l.b ?? ""}</td>
                          <td className={cx("w-5 select-none text-center", l.type === "add" ? "text-ok" : l.type === "del" ? "text-danger" : "text-muted")} aria-label={l.type === "add" ? "added" : l.type === "del" ? "removed" : undefined}>
                            {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
                          </td>
                          <td className="whitespace-pre-wrap break-words px-2">{l.text || " "}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : (
            <Card title="Version 1">
              <p className="text-sm text-muted">This is the first version — there is nothing to compare yet.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
