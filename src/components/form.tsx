"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { Button, cx } from "./ui";
import type { ActionState } from "@/server/lib/forms";

const FormCtx = createContext<ActionState & { pending?: boolean }>({});

/**
 * Form bound to a server action returning ActionState. Shows the top-level error and
 * makes field errors available to <Field>. Server actions redirect on success when appropriate.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
  }, [state, resetOnSuccess, onSuccess]);
  return (
    <FormCtx.Provider value={{ ...state, pending }}>
      {/* Submitted manually (not via the action prop) so React doesn't reset the inputs when validation fails */}
      <form
        ref={ref}
        className={className}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => formAction(fd));
        }}
      >
        {state.error && (
          <div role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {state.error}
          </div>
        )}
        {state.ok && state.message && (
          <div role="status" className="mb-4 rounded-md border border-ok/30 bg-ok-soft px-3 py-2 text-sm text-ok">
            {state.message}
          </div>
        )}
        {children}
      </form>
    </FormCtx.Provider>
  );
}

export function Field({
  label,
  name,
  hint,
  children,
  className,
  required,
}: {
  label: string;
  name: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  const { fieldErrors } = useContext(FormCtx);
  const err = fieldErrors?.[name];
  return (
    <div className={cx("min-w-0", className)}>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      <div className={err ? "[&_input]:border-danger [&_select]:border-danger [&_textarea]:border-danger" : undefined}>{children}</div>
      {err ? <p className="mt-1 text-xs text-danger">{err}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Submit({ children, variant, className }: { children: React.ReactNode; variant?: "primary" | "danger" | "secondary"; className?: string }) {
  const { pending } = useContext(FormCtx);
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

/** A button that confirms before submitting its enclosing form. */
export function ConfirmSubmit({ children, message, variant = "danger" }: { children: React.ReactNode; message: string; variant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useContext(FormCtx);
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
