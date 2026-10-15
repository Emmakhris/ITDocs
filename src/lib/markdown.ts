/**
 * Small, safe Markdown → HTML renderer for knowledge-base articles. Runs on server and client
 * (live preview). All input is HTML-escaped before any markup is added, and links are limited
 * to http(s), mailto and relative URLs, so article text can never inject script or markup.
 *
 * Supported: # headings, paragraphs (single newlines become line breaks), **bold**, *italic*,
 * ~~strike~~, `code`, ``` fenced code ```, [links](https://…), bare https:// links, - / 1. lists
 * (nested by indentation), - [ ] / - [x] checklists, > quotes, > [!NOTE] / [!TIP] / [!WARNING] /
 * [!DANGER] callouts, | tables |, and --- rules.
 */

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Inline formatting on an already-escaped string. */
function inline(escaped: string): string {
  const codes: string[] = [];
  let s = escaped.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  const links: string[] = [];
  const keep = (html: string) => `\u0001${links.push(html) - 1}\u0001`;
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text: string, url: string) => {
    const raw = url.replace(/&amp;/g, "&");
    if (!SAFE_URL.test(raw)) return text;
    const ext = /^https?:/i.test(raw);
    return keep(`<a href="${url}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`);
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (_, pre: string, url: string) => `${pre}${keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`)}`);
  s = s
    .replace(/\*\*(?=\S)([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)([^_]+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?=\S)([^*]+?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([^~]+?)~~/g, "<del>$1</del>");
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => links[Number(i)]);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const indentOf = (l: string) => l.match(/^ */)![0].length;
const LIST_ITEM = /^( *)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const CALLOUTS = { NOTE: "Note", TIP: "Tip", WARNING: "Warning", DANGER: "Danger" } as const;

function renderList(lines: string[]): string {
  const base = indentOf(lines[0]);
  const ordered = /^\s*\d/.test(lines[0]);
  const items: string[][] = [];
  for (const l of lines) {
    const m = LIST_ITEM.exec(l);
    if (m && m[1].length <= base) items.push([m[3]]);
    else items.at(-1)?.push(l);
  }
  const html = items.map(([first, ...rest]) => {
    const task = /^\[([ xX])\]\s+(.*)$/.exec(first);
    const head = task
      ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ${inline(escapeHtml(task[2]))}`
      : inline(escapeHtml(first));
    const nested = rest.filter((r) => r.trim());
    const sub = nested.length && LIST_ITEM.test(nested[0]) ? renderList(nested) : nested.length ? `<br>${nested.map((r) => inline(escapeHtml(r.trim()))).join("<br>")}` : "";
    return `<li${task ? ' class="task"' : ""}>${head}${sub}</li>`;
  });
  return ordered ? `<ol>${html.join("")}</ol>` : `<ul>${html.join("")}</ul>`;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function renderBlocks(lines: string[], usedIds: Map<string, number>): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    // Fenced code
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code${fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : ""}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    // Headings
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      const text = inline(escapeHtml(h[2]));
      let id = slugify(text) || "section";
      const n = usedIds.get(id) ?? 0;
      usedIds.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      out.push(`<h${h[1].length} id="${id}">${text}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // Quotes and callouts
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*> ?/, ""));
      const c = /^\[!(NOTE|TIP|WARNING|DANGER)\]\s*(.*)$/i.exec(body[0] ?? "");
      if (c) {
        const kind = c[1].toUpperCase() as keyof typeof CALLOUTS;
        const rest = [c[2], ...body.slice(1)].filter((x, j) => j > 0 || x.trim());
        out.push(`<div class="callout callout-${kind.toLowerCase()}"><p class="callout-title">${CALLOUTS[kind]}</p>${renderBlocks(rest, usedIds)}</div>`);
      } else out.push(`<blockquote>${renderBlocks(body, usedIds)}</blockquote>`);
      continue;
    }
    // Tables: header row, then |---|:--:| separator
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const td = (tag: string, c: string, j: number) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ""}>${inline(escapeHtml(c))}</${tag}>`;
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c, j) => td("th", c, j)).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, j) => td("td", r[j] ?? "", j)).join("")}</tr>`)
          .join("")}</tbody></table></div>`,
      );
      continue;
    }
    // Lists (continuation lines are indented or further items)
    if (LIST_ITEM.test(line)) {
      const block: string[] = [];
      const base = indentOf(line);
      while (i < lines.length && lines[i].trim() && (LIST_ITEM.test(lines[i]) || indentOf(lines[i]) > base)) block.push(lines[i++]);
      out.push(renderList(block));
      continue;
    }
    // Paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|~~~)/.test(lines[i]) && !LIST_ITEM.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim());
    out.push(`<p>${para.map((p) => inline(escapeHtml(p))).join("<br>")}</p>`);
  }
  return out.join("\n");
}

export function renderMarkdown(src: string): string {
  return renderBlocks(src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), new Map());
}

/** Headings for an article outline: level, text and anchor id (matches renderMarkdown ids). */
export function outline(src: string): { level: number; text: string; id: string }[] {
  const html = renderMarkdown(src);
  return [...html.matchAll(/<h([1-6]) id="([^"]+)">(.*?)<\/h\1>/g)].map((m) => ({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") }));
}

/** Plain-text excerpt for lists and search results. */
export function excerpt(src: string, max = 180): string {
  const text = src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s*(\[[ xX!A-Z]*\])?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
