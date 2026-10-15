"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionForm, Field, Submit } from "@/components/form";
import { Input, LinkButton, Select, cx } from "@/components/ui";
import { renderMarkdown } from "@/lib/markdown";
import type { ActionState } from "@/server/lib/forms";

type Values = {
  title?: string;
  body?: string;
  tags?: string[];
  status?: string;
  categoryId?: string | null;
  reviewEveryDays?: number | null;
  version?: number;
  isTemplate?: boolean;
};

const SNIPPETS: { label: string; title: string; before: string; after?: string; block?: boolean }[] = [
  { label: "H2", title: "Section heading", before: "## ", block: true },
  { label: "B", title: "Bold", before: "**", after: "**" },
  { label: "I", title: "Italic", before: "*", after: "*" },
  { label: "1.", title: "Numbered steps", before: "1. ", block: true },
  { label: "•", title: "Bullet list", before: "- ", block: true },
  { label: "☐", title: "Checklist", before: "- [ ] ", block: true },
  { label: "Link", title: "Link", before: "[", after: "](https://)" },
  { label: "Code", title: "Code block", before: "```\n", after: "\n```", block: true },
  { label: "Table", title: "Table", before: "| Column | Column |\n|---|---|\n| | |\n", block: true },
  { label: "Warning", title: "Warning callout", before: "> [!WARNING]\n> ", block: true },
];

export function ArticleEditor({
  action,
  values = {},
  categories,
  cancelHref,
  editing,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  values?: Values;
  categories: { id: string; name: string }[];
  cancelHref: string;
  editing: boolean;
}) {
  const [body, setBody] = useState(values.body ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [dirty, setDirty] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const preview = useMemo(() => (tab === "preview" ? renderMarkdown(body) : ""), [tab, body]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const insert = (s: (typeof SNIPPETS)[number]) => {
    const el = area.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = body.slice(a, b);
    const lead = s.block && a > 0 && body[a - 1] !== "\n" ? "\n" : "";
    const next = body.slice(0, a) + lead + s.before + sel + (s.after ?? "") + body.slice(b);
    setBody(next);
    setDirty(true);
    requestAnimationFrame(() => {
      el.focus();
      const pos = a + lead.length + s.before.length + sel.length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <ActionForm action={action} className="space-y-4" onSuccess={() => setDirty(false)}>
      {values.version !== undefined && <input type="hidden" name="baseVersion" value={values.version} />}
      {values.isTemplate && <input type="hidden" name="isTemplate" value="on" />}
      <div className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Title" name="title" required className="sm:col-span-2 lg:col-span-4">
          <Input id="title" name="title" defaultValue={values.title} onChange={() => setDirty(true)} className="text-base font-medium" />
        </Field>
        <Field label="Category" name="categoryId">
          <Select id="categoryId" name="categoryId" defaultValue={values.categoryId ?? ""}>
            <option value="">— Uncategorised —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!values.isTemplate && (
          <Field label="Status" name="status" hint="Drafts are visible only to technicians and admins">
            <Select id="status" name="status" defaultValue={values.status ?? "DRAFT"}>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
        )}
        <Field label="Tags" name="tags" hint="Comma-separated, e.g. ehr, downtime">
          <Input id="tags" name="tags" defaultValue={values.tags?.join(", ")} />
        </Field>
        {!values.isTemplate && (
          <Field label="Review every (days)" name="reviewEveryDays" hint="Leave empty for no review reminder">
            <Input id="reviewEveryDays" name="reviewEveryDays" type="number" min={1} max={3650} defaultValue={values.reviewEveryDays ?? ""} />
          </Field>
        )}
      </div>

      <Field label="Content" name="body">
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.5">
            <div className="mr-2 flex rounded-md border border-line bg-surface p-0.5" role="tablist" aria-label="Editor mode">
              {(["write", "preview"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx("rounded px-2.5 py-1 text-xs font-medium capitalize", tab === t ? "bg-brand text-brand-fg" : "text-muted hover:text-fg")}>
                  {t}
                </button>
              ))}
            </div>
            {tab === "write" &&
              SNIPPETS.map((s) => (
                <button key={s.label} type="button" title={s.title} aria-label={s.title} onClick={() => insert(s)} className="rounded px-2 py-1 text-xs font-medium text-muted hover:bg-surface hover:text-fg">
                  {s.label}
                </button>
              ))}
            <span className="ml-auto text-[11px] text-muted">Markdown</span>
          </div>
          {/* The textarea stays mounted in preview mode so its value is always submitted */}
          <textarea
            ref={area}
            id="body"
            name="body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            spellCheck
            className={cx("block min-h-[28rem] w-full resize-y bg-surface p-4 font-mono text-sm leading-relaxed text-fg focus:outline-none", tab === "preview" && "hidden")}
            placeholder={"## Purpose\nWhat this procedure is for.\n\n## Steps\n1. First step"}
          />
          {tab === "preview" && (
            <div className="md min-h-[28rem] p-4" dangerouslySetInnerHTML={{ __html: preview || '<p class="text-muted">Nothing to preview yet.</p>' }} />
          )}
        </div>
      </Field>

      <div className="flex flex-wrap items-end gap-3">
        {editing && (
          <Field label="Change note" name="changeNote" className="min-w-64 flex-1" hint="Shown in the version history, e.g. “Updated vendor phone number”">
            <Input id="changeNote" name="changeNote" />
          </Field>
        )}
        <div className="flex gap-2">
          <Submit>{editing ? "Save changes" : values.isTemplate ? "Create template" : "Create article"}</Submit>
          <LinkButton href={cancelHref}>Cancel</LinkButton>
        </div>
      </div>
    </ActionForm>
  );
}
