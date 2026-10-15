import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { dayKey, dayRange, journalDays, journalTags, listJournal } from "@/server/modules/journal";
import { renderMarkdown } from "@/lib/markdown";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Textarea, cx } from "@/components/ui";
import { deleteJournalAction, journalAction } from "../actions";
import { SectionTabs, toDateTimeInput } from "../shared";

export const metadata = { title: "Daily journal" };

type Search = { day?: string; q?: string; tag?: string; mine?: string; onCall?: string; edit?: string };

export default async function JournalPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "changes", "read");
  const sp = await searchParams;
  const today = dayKey(new Date());
  const day = sp.day && dayRange(sp.day) ? sp.day : today;
  const searching = !!(sp.q || sp.tag || sp.mine || sp.onCall);
  const [entries, days, tags] = await Promise.all([
    listJournal(ctx, { day, q: sp.q, tag: sp.tag, authorId: sp.mine ? ctx.user.id : undefined, onCall: sp.onCall === "1" }),
    journalDays(ctx, day),
    journalTags(),
  ]);
  const writable = can(ctx.user.role, "changes", "write");
  const editing = sp.edit ? entries.find((e) => e.id === sp.edit && e.editable) : undefined;
  const r = dayRange(day)!;
  const shift = (n: number) => dayKey(new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate() + n));
  const label = r.start.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <PageHeader title="Changes & incidents" subtitle="Planned changes with approval, incidents with timelines, and the daily tech journal." />
      <SectionTabs active="/changes/journal" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          {!searching && (
            <div className="flex flex-wrap items-center gap-2">
              <LinkButton size="sm" href={`/changes/journal?day=${shift(-1)}`} aria-label="Previous day">←</LinkButton>
              <h2 className="text-base font-semibold">{label}</h2>
              {day < today && <LinkButton size="sm" href={`/changes/journal?day=${shift(1)}`} aria-label="Next day">→</LinkButton>}
              {day !== today && <Link href="/changes/journal" className="text-sm text-brand hover:underline">Today</Link>}
            </div>
          )}
          {searching && (
            <p className="text-sm text-muted">
              {entries.length} matching entr{entries.length === 1 ? "y" : "ies"}
              {sp.tag && <> tagged <strong className="text-fg">#{sp.tag}</strong></>}
              {sp.mine && " by you"}
              {sp.onCall && " (on-call)"} · <Link href={`/changes/journal?day=${day}`} className="text-brand hover:underline">Clear</Link>
            </p>
          )}

          {writable && !searching && (day === today || editing) && (
            <Card title={editing ? "Edit entry" : "Add to today's journal"}>
              <ActionForm key={editing?.id ?? "new"} action={journalAction.bind(null, editing?.id ?? null, day)} className="space-y-3" resetOnSuccess={!editing}>
                <Field label="What happened" name="text" hint="Markdown. Short is fine — this is the shift log.">
                  <Textarea id="text" name="text" defaultValue={editing?.text} className="min-h-20" placeholder="e.g. Replaced toner in ED-PRN-02. Called out 02:10 for UPS alarm in MDF — battery swapped." />
                </Field>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
                  <Field label="Tags" name="tags"><Input id="tags" name="tags" defaultValue={editing?.tags.join(", ")} placeholder="ups, printer, ehr" /></Field>
                  <Field label="Time" name="at" hint="Leave empty for now"><Input id="at" name="at" type="datetime-local" defaultValue={editing ? toDateTimeInput(editing.at) : ""} /></Field>
                  <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="onCall" defaultChecked={editing?.onCall} className="h-4 w-4 accent-brand" /> On-call call-out</label>
                </div>
                <div className="flex gap-2">
                  <Submit>{editing ? "Save" : "Add entry"}</Submit>
                  {editing && <LinkButton href={`/changes/journal?day=${day}`}>Cancel</LinkButton>}
                </div>
              </ActionForm>
            </Card>
          )}

          {entries.length === 0 ? (
            <Empty title={searching ? "Nothing found" : "Nothing logged this day"}>{!searching && day === today && writable && "Add the first entry above."}</Empty>
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
              {entries.map((e) => (
                <li key={e.id} id={`e-${e.id}`} className={cx("flex gap-3 px-4 py-3", editing?.id === e.id && "bg-brand-soft/40")}>
                  <div className="w-16 shrink-0 text-right">
                    <p className="font-mono text-sm tabular-nums">{time(e.at)}</p>
                    {searching && <Link href={`/changes/journal?day=${dayKey(e.at)}#e-${e.id}`} className="text-xs text-muted hover:text-fg">{e.at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</Link>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="md text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(e.text) }} />
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span>{e.authorName}</span>
                      {e.onCall && <Badge tone="amber"><PhoneCall className="mr-1 h-3 w-3" aria-hidden />on-call</Badge>}
                      {e.tags.map((t) => <Link key={t} href={`/changes/journal?tag=${encodeURIComponent(t)}`} className="hover:text-fg">#{t}</Link>)}
                      {e.updatedAt.getTime() - e.createdAt.getTime() > 1000 && <span>(edited)</span>}
                      {e.editable && (
                        <>
                          <Link href={`/changes/journal?day=${dayKey(e.at)}&edit=${e.id}`} className="text-brand hover:underline">Edit</Link>
                          <ActionForm action={deleteJournalAction.bind(null, e.id)} className="inline">
                            <ConfirmSubmit variant="secondary" message="Delete this entry?">Delete</ConfirmSubmit>
                          </ActionForm>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="space-y-4">
          <Card title="Search the journal">
            <form className="space-y-2">
              <Input name="q" defaultValue={sp.q} placeholder="Words in entries…" aria-label="Search journal" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={!!sp.mine} className="h-4 w-4 accent-brand" /> Only my entries</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="onCall" value="1" defaultChecked={sp.onCall === "1"} className="h-4 w-4 accent-brand" /> Only on-call</label>
              <Button variant="secondary" size="sm">Search</Button>
            </form>
          </Card>
          <Card title="Last two weeks">
            <ul className="grid grid-cols-7 gap-1 text-center text-xs">
              {days.map((d) => (
                <li key={d.day}>
                  <Link
                    href={`/changes/journal?day=${d.day}`}
                    title={`${d.date.toDateString()}: ${d.n} entr${d.n === 1 ? "y" : "ies"}${d.onCall ? `, ${d.onCall} on-call` : ""}`}
                    className={cx("block rounded py-1", d.day === day && !searching ? "bg-brand text-brand-fg" : d.n ? "bg-brand-soft text-brand hover:opacity-80" : "text-muted hover:bg-surface-2")}
                  >
                    <span className="block text-[10px] opacity-70">{d.date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                    {d.date.getDate()}
                    {d.onCall > 0 && <span className="block text-[10px] leading-none text-warn">●</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {tags.length > 0 && (
            <Card title="Tags (90 days)">
              <div className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <Link key={t.tag} href={`/changes/journal?tag=${encodeURIComponent(t.tag)}`} className={cx("rounded px-1.5 py-0.5 text-xs", sp.tag === t.tag ? "bg-brand text-brand-fg" : "bg-surface-2 text-muted hover:text-fg")}>#{t.tag} <span className="opacity-70">{t.count}</span></Link>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
