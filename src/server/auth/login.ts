import "server-only";
import bcrypt from "bcryptjs";
import { verify as verifyTotp } from "otplib";
import { db } from "../db";
import { audit } from "../audit/log";
import { ldapAuthenticate } from "./ldap";
import { createSession, requestMeta } from "./session";

// Simple in-memory brute-force throttle (per username+IP). Fine for a single app container.
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; needTotp?: boolean };

export async function login(usernameRaw: string, password: string, totp?: string): Promise<LoginResult> {
  const username = usernameRaw.trim().toLowerCase().replace(/^.*\\/, ""); // accept DOMAIN\user
  const meta = await requestMeta();
  const key = `${username}|${meta.ip ?? ""}`;
  const f = failures.get(key);
  if (f && f.until > Date.now()) {
    return { ok: false, error: "Too many failed attempts. Try again in a few minutes." };
  }

  const fail = async (reason: string, error = "Invalid username or password.") => {
    const cur = failures.get(key) ?? { count: 0, until: 0 };
    cur.count++;
    if (cur.count >= MAX_FAILS) cur.until = Date.now() + LOCK_MS;
    failures.set(key, cur);
    await audit(db, { user: { id: "", username, displayName: username, role: "READONLY" }, ...meta }, {
      action: "login_failed",
      entityType: "User",
      summary: `Failed login for "${username}": ${reason}`,
    }).catch(() => {});
    return { ok: false as const, error };
  };

  const existing = await db.user.findUnique({ where: { username } });

  // ── Local (break-glass) account ──
  if (existing?.source === "LOCAL") {
    if (!existing.active || !existing.passwordHash) return fail("inactive");
    if (!(await bcrypt.compare(password, existing.passwordHash))) return fail("bad password");
    if (existing.totpEnabled && existing.totpSecret) {
      if (!totp) return { ok: false, error: "Enter your authenticator code.", needTotp: true };
      const r = await verifyTotp({ secret: existing.totpSecret, token: totp.replace(/\s/g, "") });
      if (!r.valid) return { ...(await fail("bad totp", "Invalid authenticator code.")), needTotp: true };
    }
    return finish(existing.id, existing.displayName, existing.role, meta, "local");
  }

  // ── Active Directory / LDAP ──
  const r = await ldapAuthenticate(username, password);
  if (!r.ok) {
    if (r.reason === "unavailable")
      return { ok: false, error: "Directory server unreachable. Use a break-glass account if this persists." };
    if (r.reason === "disabled") return fail("ldap disabled");
    return fail("bad credentials");
  }
  if (!r.role && process.env.LDAP_REQUIRE_GROUP !== "false") {
    return fail(`no mapped group (groups: ${r.groups.join(", ") || "none"})`,
      "Your account is not in an authorised IT group. Contact an administrator.");
  }
  const role = r.role ?? "READONLY";
  const user = await db.user.upsert({
    where: { username: r.username },
    create: { username: r.username, displayName: r.displayName, email: r.email, role, source: "LDAP" },
    update: { displayName: r.displayName, email: r.email, role },
  });
  if (!user.active) return fail("account disabled in ITDocs");
  return finish(user.id, user.displayName, user.role, meta, "ldap");
}

async function finish(
  userId: string,
  displayName: string,
  role: import("@prisma/client").Role,
  meta: { ip?: string; userAgent?: string },
  method: string,
): Promise<LoginResult> {
  const user = await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  for (const k of failures.keys()) if (k.startsWith(user.username + "|")) failures.delete(k);
  await createSession(userId);
  await audit(db, { user: { id: userId, username: user.username, displayName, role }, ...meta }, {
    action: "login",
    entityType: "User",
    entityId: userId,
    summary: `Signed in (${method})`,
  });
  return { ok: true };
}
