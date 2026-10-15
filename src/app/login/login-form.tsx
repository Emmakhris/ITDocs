"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  // Controlled so values survive React's automatic form reset when the TOTP step appears
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      )}
      <div className={state.needTotp ? "hidden" : "space-y-4"}>
        <div>
          <label htmlFor="username" className="mb-1 block text-xs font-medium text-muted">Username</label>
          <Input id="username" name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required placeholder="jsmith or DOMAIN\jsmith" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-muted">Password</label>
          <Input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
      </div>
      {state.needTotp && (
        <div>
          <label htmlFor="totp" className="mb-1 block text-xs font-medium text-muted">Authenticator code</label>
          <Input id="totp" name="totp" inputMode="numeric" autoComplete="one-time-code" autoFocus required pattern="[0-9 ]{6,7}" />
        </div>
      )}
      <SubmitBtn />
    </form>
  );
}
