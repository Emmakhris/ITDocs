import "server-only";
import bcrypt from "bcryptjs";
import { verify as verifyTotp } from "otplib";
import { db } from "../db";
import { audit } from "../audit/log";
import { ldapAuthenticate } from "./ldap";
import { createSession, requestMeta } from "./session";
import { LIMITS, hit, peek, reset } from "../lib/rate-limit";

// Brute-force protection (shared by all app instances via the RateLimit table):
// 5 failures per username + IP lock that pair for 15 minutes, and one IP gets 50 attempts per
// 15 minutes across all usernames (password spraying).

const LOCK = LIMITS.loginFailures;

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string; needTotp?: boolean };

export async function login(usernameRaw: string, password: string, totp?: string): Promise<LoginResult> {
  const username = usernameRaw.trim().toLowerCase().replace(/^.*\\/, ""); // accept DOMAIN\user
  const meta = await requestMeta();
  const failKey = `login-fail:${username}|${meta.ip ?? ""}`;
  const who = { user: { id: "", username, displayName: username, role: "READONLY" as const }, ...meta };
  const locked = await peek(failKey, LOCK);
  if (locked.count >= LOCK.limit) {
    return { ok: false, error: `Too many failed attempts. Try again in ${Math.ceil(locked.retryAfterSec / 60)} minute(s).` };
  }
  const perIp = await hit(`login-ip:${meta.ip ?? "unknown"}`, LIMITS.loginPerIp);
  if (!perIp.allowed) {
    if (perIp.count === LIMITS.loginPerIp.limit + 1)
      await audit(db, who, { action: "login_locked", entityType: "User", summary: `Sign-in attempts from ${meta.ip ?? "unknown IP"} blocked for ${Math.ceil(perIp.retryAfterSec / 60)} min (too many attempts)` }).catch(() => {});
    return { ok: false, error: "Too many sign-in attempts from this address. Try again later." };
  }

  const fail = async (reason: string, error = "Invalid username or password.") => {
    const r = await hit(failKey, LOCK);
    await audit(db, who, { action: "login_failed", entityType: "User", summary: `Failed login for "${username}": ${reason}` }).catch(() => {});
    if (r.count === LOCK.limit)
      await audit(db, who, { action: "login_locked", entityType: "User", summary: `"${username}" locked out for 15 min from ${meta.ip ?? "unknown IP"} after ${LOCK.limit} failed attempts` }).catch(() => {});
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
  await reset(`login-fail:${user.username}|${meta.ip ?? ""}`);
  await createSession(userId);
  await audit(db, { user: { id: userId, username: user.username, displayName, role }, ...meta }, {
    action: "login",
    entityType: "User",
    entityId: userId,
    summary: `Signed in (${method})`,
  });
  return { ok: true };
}
