"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { SearchHit } from "@/server/modules/search";
import { cx } from "@/components/ui";

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // Ctrl/Cmd+K or "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (r.ok) {
          setHits(await r.json());
          setSel(0);
        }
      } catch {
        /* aborted */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const go = (h?: SearchHit) => {
    if (!h) {
      if (q.trim()) router.push(`/assets?q=${encodeURIComponent(q.trim())}`);
      return;
    }
    setOpen(false);
    setQ("");
    router.push(h.href);
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((s) => Math.min(s + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setSel((s) => Math.max(s - 1, 0));
          else if (e.key === "Enter") go(hits[sel]);
          else if (e.key === "Escape") input.current?.blur();
          else return;
          e.preventDefault();
        }}
        placeholder="Search tag, serial, hostname, IP, person…  (Ctrl+K)"
        className="h-9 w-full rounded-md border border-line bg-surface-2 pl-8 pr-3 text-sm placeholder:text-muted focus:bg-surface focus:outline-2 focus:outline-brand"
        aria-label="Global search"
      />
      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-11 z-30 max-h-96 overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {hits.map((h, i) => (
            <li key={h.kind + h.id}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h)}
                className={cx("flex w-full items-start gap-2 px-3 py-2 text-left text-sm", i === sel && "bg-surface-2")}
              >
                <span className="mt-0.5 w-16 shrink-0 text-[11px] uppercase tracking-wide text-muted">{h.kind}</span>
                <span className="min-w-0">
                  <span className="block truncate">{h.title}</span>
                  {h.subtitle && <span className="block truncate text-xs text-muted">{h.subtitle}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
