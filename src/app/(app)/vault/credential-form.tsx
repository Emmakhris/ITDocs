"use client";

import { useState } from "react";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { ActionForm, Field, Submit } from "@/components/form";
import { Button, Card, Input, LinkButton, Select, Textarea } from "@/components/ui";
import type { ActionState } from "@/server/lib/forms";

/** Cryptographically random password from the browser's CSPRNG (unbiased via rejection sampling). */
function generatePassword(length = 24) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?";
  const out: string[] = [];
  const max = 256 - (256 % chars.length);
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of buf) if (b < max && out.length < length) out.push(chars[b % chars.length]);
  }
  return out.join("");
}

export function CredentialForm({
  action,
  folders,
  values = {},
  isEdit,
  hasTotp,
  assetId,
  cancelHref,
}: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  folders: { id: string; name: string }[];
  values?: Record<string, string | number | null | undefined>;
  isEdit?: boolean;
  hasTotp?: boolean;
  assetId?: string;
  cancelHref: string;
}) {
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const v = (k: string) => (values[k] === null || values[k] === undefined ? "" : String(values[k]));

  return (
    <ActionForm action={action} className="max-w-3xl space-y-4">
      {assetId && <input type="hidden" name="assetId" value={assetId} />}
      <Card title="Credential">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name="title" required className="sm:col-span-2">
            <Input id="title" name="title" defaultValue={v("title")} placeholder="e.g. Core switch admin — SW-CORE-01" />
          </Field>
          <Field label="Folder" name="folderId" required>
            <Select id="folderId" name="folderId" defaultValue={v("folderId")}>
              <option value="">Choose…</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Username" name="username">
            <Input id="username" name="username" defaultValue={v("username")} autoComplete="off" className="font-mono" />
          </Field>
          <Field
            label={isEdit ? "New password / secret" : "Password / secret"}
            name="password"
            required={!isEdit}
            hint={isEdit ? "Leave blank to keep the current one. Changing it saves the old one to history." : undefined}
            className="sm:col-span-2"
          >
            <div className="flex gap-2">
              <Input
                id="password"
                name="password"
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoComplete="new-password"
                className="font-mono"
              />
              <Button type="button" variant="secondary" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Show"}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPw(generatePassword());
                  setShow(true);
                }}
              >
                <Wand2 className="h-4 w-4" /> Generate
              </Button>
            </div>
          </Field>
          <Field label="URL / host" name="url" hint="https://…, ssh://…, or a hostname / IP">
            <Input id="url" name="url" defaultValue={v("url")} />
          </Field>
          <Field label="Rotate every (days)" name="rotateEveryDays" hint="Optional — flags the credential when due">
            <Input id="rotateEveryDays" name="rotateEveryDays" type="number" min={1} defaultValue={v("rotateEveryDays")} />
          </Field>
          <Field label="Notes" name="notes" className="sm:col-span-2" hint="Not encrypted — don't put secrets here">
            <Textarea id="notes" name="notes" defaultValue={v("notes")} rows={3} />
          </Field>
        </div>
      </Card>
      <Card title="Two-factor (TOTP)">
        <Field label={hasTotp ? "Replace TOTP seed" : "TOTP seed"} name="totpSeed" hint="Base32 seed or the otpauth:// link from the QR code. Stored encrypted; the vault shows the current 6-digit code.">
          <Input id="totpSeed" name="totpSeed" autoComplete="off" className="font-mono" />
        </Field>
        {hasTotp && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="clearTotp" className="h-4 w-4" /> Remove the stored TOTP seed
          </label>
        )}
      </Card>
      <div className="flex gap-2">
        <Submit>{isEdit ? "Save changes" : "Save credential"}</Submit>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
