"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui";
import { revealKeyAction } from "./actions";

const HIDE_AFTER_MS = 30_000;

/** Masked licence key with Reveal / Copy. Each fetch is audited on the server; the value hides after 30 s. */
export function LicenseKeyField({ licenseId }: { licenseId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const fetchKey = async (purpose: "reveal" | "copy") => {
    setBusy(true);
    setMsg(null);
    const r = await revealKeyAction(licenseId, purpose);
    setBusy(false);
    if (r.error) setMsg(r.error);
    return r.value ?? null;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded border border-line bg-surface-2 px-2 py-1.5 font-mono text-sm">{value ?? "•••••-•••••-•••••-•••••"}</code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            if (value !== null) return setValue(null);
            const v = await fetchKey("reveal");
            if (v === null) return;
            setValue(v);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setValue(null), HIDE_AFTER_MS);
          }}
        >
          {value !== null ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {value !== null ? "Hide" : "Reveal"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            const v = await fetchKey("copy");
            if (v === null) return;
            try {
              await navigator.clipboard.writeText(v);
              setMsg("Copied");
            } catch {
              setMsg("Clipboard not available — use Reveal instead.");
            }
          }}
        >
          <Copy className="h-4 w-4" /> Copy
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">{msg ?? "Reveals and copies are recorded in the audit log."}</p>
    </div>
  );
}
