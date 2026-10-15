"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { createTokenAction, type CreateTokenState } from "./token-actions";

const MODULE_LABELS: Record<string, string> = {
  assets: "Assets",
  locations: "Locations",
  people: "People",
  network: "Network",
  kb: "Knowledge base",
  software: "Software",
  vendors: "Vendors & contracts",
  changes: "Changes & incidents",
  reports: "Reports",
};

/** Creates a token and shows it once. The plaintext only ever exists in this component's state. */
export function TokenForm({ modules, canWrite }: { modules: string[]; canWrite: boolean }) {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(createTokenAction, {});
  const [copied, setCopied] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  if (state.ok && state.token)
    return (
      <div className="space-y-3 rounded-md border border-ok/30 bg-ok-soft p-3 text-sm">
        <p className="font-medium text-ok">Token “{state.name}” created. Copy it now — it won&apos;t be shown again.</p>
        <div className="flex gap-2">
          <code className="min-w-0 flex-1 break-all rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs">{state.token}</code>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.token!).catch(() => {});
              setCopied(true);
            }}
          >
            <Copy className="h-4 w-4" aria-hidden /> {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted">Use it as <code className="font-mono">Authorization: Bearer …</code>. API reference: <a className="text-brand hover:underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a></p>
        <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>Done</Button>
      </div>
    );

  return (
    <form
      ref={form}
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      {state.error && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}{state.fieldErrors && ` ${Object.values(state.fieldErrors).join(" ")}`}</p>}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Name</span>
          <Input name="name" placeholder="e.g. Intune export script" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Expires</span>
          <Select name="expiresInDays" defaultValue="90">
            <option value="30">in 30 days</option>
            <option value="90">in 90 days</option>
            <option value="180">in 180 days</option>
            <option value="365">in 1 year</option>
            <option value="0">never</option>
          </Select>
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted">Modules (none ticked = everything your role allows)</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-3">
          {modules.map((m) => (
            <label key={m} className="flex items-center gap-2"><input type="checkbox" name="scopes" value={m} className="h-4 w-4 accent-brand" />{MODULE_LABELS[m] ?? m}</label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="readOnly" defaultChecked disabled={!canWrite} className="h-4 w-4 accent-brand" />
        Read-only {!canWrite && <span className="text-xs text-muted">(your role is read-only)</span>}
      </label>
      {!canWrite && <input type="hidden" name="readOnly" value="on" />}
      <Button type="submit" disabled={pending}><KeyRound className="h-4 w-4" aria-hidden /> {pending ? "Creating…" : "Create token"}</Button>
    </form>
  );
}
