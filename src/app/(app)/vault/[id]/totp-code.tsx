"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { revealAction } from "../actions";

/** Shows the current 6-digit code on request (audited) with the seconds left in its 30 s window. */
export function TotpCode({ credentialId }: { credentialId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const s = 30 - (Math.floor(Date.now() / 1000) % 30);
      setLeft(s);
      if (s === 30) setCode(null); // window rolled over — hide the stale code
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [code]);

  const show = async (purpose: "reveal" | "copy") => {
    setErr(null);
    const r = await revealAction(credentialId, { field: "totp" }, purpose);
    if (r.error || !r.value) return setErr(r.error ?? "Failed");
    setCode(r.value);
    if (purpose === "copy") await navigator.clipboard?.writeText(r.value).catch(() => setErr("Clipboard unavailable"));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="rounded-md border border-line bg-surface-2 px-3 py-1.5 font-mono text-lg tracking-widest">
        {code ? `${code.slice(0, 3)} ${code.slice(3)}` : "••• •••"}
      </code>
      {code && <span className="text-xs text-muted tabular-nums">{left}s</span>}
      <Button type="button" size="sm" variant="secondary" onClick={() => show("reveal")}>Show code</Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => show("copy")}>Copy</Button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
