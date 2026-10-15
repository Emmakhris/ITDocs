import "server-only";
import { Client } from "ldapts";
import type { Role } from "@prisma/client";
import { db } from "../db";

const env = (k: string, d = "") => process.env[k] || d;

/** RFC 4515 filter escaping — prevents LDAP injection via the username field. */
export function escapeFilter(v: string) {
  return v.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

function client() {
  return new Client({
    url: env("LDAP_URL"),
    timeout: 8000,
    connectTimeout: 5000,
    tlsOptions: { rejectUnauthorized: env("LDAP_TLS_REJECT_UNAUTHORIZED", "true") !== "false" },
  });
}

/** Extract the CN from a DN (CN=IT-Admins,OU=Groups,... → IT-Admins). */
const cnOf = (dn: string) => /^cn=([^,]+)/i.exec(dn)?.[1] ?? dn;

export type LdapResult =
  | { ok: true; username: string; displayName: string; email?: string; groups: string[]; role: Role | null }
  | { ok: false; reason: "invalid" | "unavailable" | "disabled" };

export async function ldapAuthenticate(username: string, password: string): Promise<LdapResult> {
  if (env("LDAP_ENABLED") !== "true") return { ok: false, reason: "disabled" };
  if (!username || !password) return { ok: false, reason: "invalid" }; // blocks unauthenticated bind
  const svc = client();
  try {
    await svc.bind(env("LDAP_BIND_DN"), env("LDAP_BIND_PASSWORD"));
  } catch (e) {
    console.error("LDAP service bind failed:", (e as Error).message);
    await svc.unbind().catch(() => {});
    return { ok: false, reason: "unavailable" };
  }
  try {
    const uAttr = env("LDAP_USERNAME_ATTR", "sAMAccountName");
    const dAttr = env("LDAP_DISPLAYNAME_ATTR", "displayName");
    const mAttr = env("LDAP_EMAIL_ATTR", "mail");
    const filter = env("LDAP_USER_FILTER", "(&(objectClass=user)(sAMAccountName={{username}}))").replaceAll(
      "{{username}}",
      escapeFilter(username),
    );
    const { searchEntries } = await svc.search(env("LDAP_BASE_DN"), {
      scope: "sub",
      filter,
      attributes: [uAttr, dAttr, mAttr, "memberOf"],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) return { ok: false, reason: "invalid" };
    const entry = searchEntries[0];

    // Verify the password by binding as the user
    const userClient = client();
    try {
      await userClient.bind(entry.dn, password);
    } catch {
      return { ok: false, reason: "invalid" };
    } finally {
      await userClient.unbind().catch(() => {});
    }

    const groups = new Set<string>();
    const memberOf = entry.memberOf;
    for (const g of Array.isArray(memberOf) ? memberOf : memberOf ? [memberOf] : []) groups.add(cnOf(String(g)));
    if (env("LDAP_GROUP_FILTER")) {
      const gf = env("LDAP_GROUP_FILTER").replaceAll("{{dn}}", escapeFilter(entry.dn));
      const res = await svc.search(env("LDAP_GROUP_BASE_DN", env("LDAP_BASE_DN")), {
        scope: "sub",
        filter: gf,
        attributes: ["cn"],
      });
      for (const g of res.searchEntries) groups.add(cnOf(g.dn));
    }

    const str = (v: unknown) => (Array.isArray(v) ? String(v[0] ?? "") : v ? String(v) : "");
    return {
      ok: true,
      username: (str(entry[uAttr]) || username).toLowerCase(),
      displayName: str(entry[dAttr]) || username,
      email: str(entry[mAttr]) || undefined,
      groups: [...groups],
      role: await roleForGroups([...groups]),
    };
  } catch (e) {
    console.error("LDAP search failed:", (e as Error).message);
    return { ok: false, reason: "unavailable" };
  } finally {
    await svc.unbind().catch(() => {});
  }
}

export async function roleForGroups(groups: string[]): Promise<Role | null> {
  if (!groups.length) return null;
  const lower = groups.map((g) => g.toLowerCase());
  const maps = await db.ldapGroupMapping.findMany({ orderBy: { priority: "desc" } });
  return maps.find((m) => lower.includes(m.groupName.toLowerCase()))?.role ?? null;
}
