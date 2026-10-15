"use client";

import { Button, LinkButton } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /permission/i.test(error.message);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">{forbidden ? "Access denied" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-muted">
        {forbidden ? "Your role does not allow this. Ask an administrator if you need access." : "The error has been logged."}
        {error.digest && <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span>}
      </p>
      <div className="mt-5 flex justify-center gap-2">
        {!forbidden && <Button onClick={reset}>Try again</Button>}
        <LinkButton href="/dashboard">Dashboard</LinkButton>
      </div>
    </div>
  );
}
