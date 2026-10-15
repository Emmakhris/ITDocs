import { redirect } from "next/navigation";
import { getCtx } from "@/server/auth/session";
import { getSettings } from "@/server/modules/settings";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCtx()) redirect("/dashboard");
  const { next } = await searchParams;
  const settings = await getSettings();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-lg font-bold text-brand-fg">IT</div>
          <h1 className="text-lg font-semibold">ITDocs</h1>
          <p className="text-sm text-muted">{settings.orgName}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"} />
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Sign in with your network (Active Directory) account. Access is logged.
        </p>
      </div>
    </main>
  );
}
