"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui";
import type { RevealWhat } from "@/server/modules/vault";
import { revealAction } from "./actions";

const HIDE_AFTER_MS = 30_000;
const CLEAR_CLIPBOARD_MS = 30_000;

/**
 * Masked secret with Reveal / Copy. The value is fetched from the server on demand (each fetch is
 * audited), shown for 30 s, then discarded. Copied values are wiped from the clipboard after 30 s
 * if the clipboard still holds them.
 */
export function SecretField({ credentialId, what, label = "password" }: { credentialId: string; what: RevealWhat; label?: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const fetchValue = async (purpose: "reveal" | "copy") => {
    setBusy(true);
    setMsg(null);
    const r = await revealAction(credentialId, what, purpose);
    setBusy(false);
    if (r.error) setMsg(r.error);
    return r.value ?? null;
  };

  const reveal = async () => {
    if (value !== null) {
      setValue(null);
      return;
    }
    const v = await fetchValue("reveal");
    if (v === null) return;
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setValue(null), HIDE_AFTER_MS);
  };

  const copy = async () => {
    const v = await fetchValue("copy");
    if (v === null) return;
    try {
      await navigator.clipboard.writeText(v);
      setMsg(`Copied — clipboard clears in ${CLEAR_CLIPBOARD_MS / 1000}s`);
      setTimeout(async () => {
        try {
          if ((await navigator.clipboard.readText()) === v) await navigator.clipboard.writeText("");
        } catch {
          /* clipboard read not permitted — leave it */
        }
        setMsg(null);
      }, CLEAR_CLIPBOARD_MS);
    } catch {
      setMsg("Clipboard unavailable (requires HTTPS). Use Reveal instead.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-40 flex-1 break-all rounded-md border border-line bg-surface-2 px-3 py-1.5 font-mono text-sm" aria-live="polite">
          {value ?? "••••••••••••"}
        </code>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={reveal} aria-label={value ? `Hide ${label}` : `Reveal ${label}`}>
          {value ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {value ? "Hide" : "Reveal"}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={copy} aria-label={`Copy ${label}`}>
          <Copy className="h-4 w-4" /> Copy
        </Button>
      </div>
      {msg && <p className="mt-1 text-xs text-muted">{msg}</p>}
    </div>
  );
}
