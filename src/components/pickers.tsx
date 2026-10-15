"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Select, cx } from "./ui";

export type Option = { id: string; label: string; sub?: string };

/** Searchable picker backed by /api/lookup/<kind>. Submits the chosen id in a hidden input. */
export function RemotePicker({
  name,
  kind,
  initial,
  placeholder = "Search…",
  id,
}: {
  name: string;
  kind: "people" | "assets";
  initial?: Option | null;
  placeholder?: string;
  id?: string;
}) {
  const [value, setValue] = useState<Option | null>(initial ?? null);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState<Option[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lookup/${kind}?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (r.ok) setOpts(await r.json());
      } catch {
        /* aborted */
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open, kind]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative">
      <input type="hidden" name={name} value={value?.id ?? ""} />
      {value ? (
        <div className="flex h-9 items-center justify-between rounded-md border border-line bg-surface px-3 text-sm">
          <span className="truncate">{value.label}</span>
          <button type="button" onClick={() => setValue(null)} className="ml-2 text-muted hover:text-fg" aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <input
          id={id}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted focus:outline-2 focus:outline-brand"
        />
      )}
      {open && !value && (
        <ul className="absolute left-0 right-0 top-10 z-30 max-h-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {opts.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
          {opts.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => {
                  setValue(o);
                  setOpen(false);
                  setQ("");
                }}
              >
                {o.label}
                {o.sub && <span className="block text-xs text-muted">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type LocationOpt = { id: string; path: string; depth: number; name: string };

/** Location <select> rendered as an indented tree. */
export function LocationSelect({
  name,
  locations,
  defaultValue,
  emptyLabel = "— No location —",
  className,
  id,
}: {
  name: string;
  locations: LocationOpt[];
  defaultValue?: string | null;
  emptyLabel?: string;
  className?: string;
  id?: string;
}) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ""} className={cx(className)}>
      <option value="">{emptyLabel}</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id} title={l.path}>
          {"  ".repeat(l.depth) + l.name}
        </option>
      ))}
    </Select>
  );
}
