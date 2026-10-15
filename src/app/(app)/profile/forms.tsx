"use client";

import { ActionForm, Field, Submit } from "@/components/form";
import { Input } from "@/components/ui";
import { changePasswordAction, enableTotpAction } from "./actions";

export function TotpForm({ secret }: { secret: string }) {
  return (
    <ActionForm action={enableTotpAction} className="flex items-end gap-2">
      <input type="hidden" name="secret" value={secret} />
      <Field label="Code" name="code"><Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" className="w-32" /></Field>
      <Submit>Enable MFA</Submit>
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
      <Field label="Current password" name="current"><Input id="current" name="current" type="password" autoComplete="current-password" /></Field>
      <Field label="New password" name="next" hint="14+ characters, upper, lower and digits"><Input id="next" name="next" type="password" autoComplete="new-password" /></Field>
      <Submit>Change password</Submit>
    </ActionForm>
  );
}
