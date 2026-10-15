"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";

/** Extract an asset tag from scanned text: either a /a/<tag> URL from our labels or a bare tag / barcode. */
function tagFrom(text: string) {
  const t = text.trim();
  const m = /\/a\/([^/?#]+)/.exec(t);
  return m ? decodeURIComponent(m[1]) : t;
}

export function Scanner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const stopRef = useRef<() => void>(() => {});

  const lookup = async (raw: string) => {
    const tag = tagFrom(raw);
    if (!tag) return;
    setErr(null);
    const r = await fetch(`/api/lookup/assets?q=${encodeURIComponent(tag)}`);
    const hits: { id: string; label: string }[] = r.ok ? await r.json() : [];
    const exact = hits.find((h) => h.label.split(" · ")[0].toLowerCase() === tag.toLowerCase()) ?? (hits.length === 1 ? hits[0] : null);
    if (exact) {
      stopRef.current();
      router.push(`/scan/${exact.id}`);
    } else setErr(hits.length ? `Several matches for "${tag}" — refine the search.` : `No asset found for "${tag}".`);
  };

  const start = async () => {
    setErr(null);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      setActive(true);
      let handled = false;
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        video.current!,
        (result) => {
          if (result && !handled) {
            handled = true;
            navigator.vibrate?.(80);
            lookup(result.getText()).finally(() => setTimeout(() => (handled = false), 1500));
          }
        },
      );
      stopRef.current = () => {
        controls.stop();
        setActive(false);
      };
    } catch (e) {
      setActive(false);
      setErr(
        (e as Error).name === "NotAllowedError"
          ? "Camera permission was denied."
          : "Camera unavailable. Browsers only allow the camera over HTTPS (or localhost).",
      );
    }
  };

  useEffect(() => () => stopRef.current(), []);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="overflow-hidden rounded-lg border border-line bg-black">
        <video ref={video} className={active ? "aspect-square w-full object-cover" : "hidden"} muted playsInline />
        {!active && (
          <div className="flex aspect-square items-center justify-center">
            <Button onClick={start}>Start camera</Button>
          </div>
        )}
      </div>
      {active && (
        <Button variant="secondary" className="w-full" onClick={() => stopRef.current()}>
          Stop camera
        </Button>
      )}
      {err && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          lookup(manual);
        }}
      >
        <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Type or scan a tag / serial…" autoFocus aria-label="Asset tag" />
        <Button type="submit">Find</Button>
      </form>
    </div>
  );
}
