"use server";

import { redirect } from "next/navigation";
import { login } from "@/server/auth/login";
import { destroySession, getCtx } from "@/server/auth/session";
import { audit } from "@/server/audit/log";
import { db } from "@/server/db";

export type LoginState = { error?: string; needTotp?: boolean };

export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const username = String(fd.get("username") ?? "");
  const password = String(fd.get("password") ?? "");
  const totp = String(fd.get("totp") ?? "") || undefined;
  const next = String(fd.get("next") ?? "/dashboard");
  const r = await login(username, password, totp);
  if (!r.ok) return { error: r.error, needTotp: r.needTotp };
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  const ctx = await getCtx();
  if (ctx) await audit(db, ctx, { action: "logout", entityType: "User", entityId: ctx.user.id, summary: "Signed out" });
  await destroySession();
  redirect("/login");
}
