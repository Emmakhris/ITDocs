import "server-only";
import { db } from "../db";
import { can } from "../rbac/permissions";
import type { Ctx } from "../context";
import { accessibleFolderIds } from "./vault";

export type SearchHit = { kind: string; id: string; title: string; subtitle?: string; href: string };

/** Global search across modules. Each module contributes hits the user is allowed to read. */
export async function globalSearch(ctx: Ctx, q: string, limit = 8): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const ci = { contains: term, mode: "insensitive" as const };
  const hits: SearchHit[] = [];
  const tasks: Promise<void>[] = [];

  if (can(ctx.user.role, "assets", "read")) {
    tasks.push(
      db.asset
        .findMany({
          where: {
            deletedAt: null,
            OR: [{ tag: ci }, { name: ci }, { serial: ci }, { hostname: ci }, { ipAddress: { startsWith: term } }, { macAddress: ci }],
          },
          include: { type: true },
          take: limit,
          orderBy: { tag: "asc" },
        })
        .then((rows) => {
          for (const a of rows)
            hits.push({ kind: "Asset", id: a.id, title: `${a.tag} · ${a.name}`, subtitle: [a.type.name, a.serial, a.hostname].filter(Boolean).join(" · "), href: `/assets/${a.id}` });
        }),
    );
  }
  if (can(ctx.user.role, "locations", "read")) {
    tasks.push(
      db.location.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { code: ci }] }, take: limit }).then((rows) => {
        for (const l of rows) hits.push({ kind: "Location", id: l.id, title: l.name, subtitle: l.type, href: `/locations/${l.id}` });
      }),
    );
  }
  if (can(ctx.user.role, "people", "read")) {
    tasks.push(
      db.person.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { email: ci }, { employeeId: ci }] }, take: limit }).then((rows) => {
        for (const p of rows) hits.push({ kind: "Person", id: p.id, title: p.name, subtitle: p.email ?? undefined, href: `/people/${p.id}` });
      }),
    );
  }
  if (can(ctx.user.role, "vault", "read")) {
    // Titles / usernames only, and only from folders this user may open
    tasks.push(
      accessibleFolderIds(ctx).then((folderIds) =>
        db.credential
          .findMany({
            where: { deletedAt: null, folderId: { in: folderIds }, OR: [{ title: ci }, { username: ci }, { url: ci }] },
            select: { id: true, title: true, username: true },
            take: limit,
          })
          .then((rows) => {
            for (const c of rows) hits.push({ kind: "Credential", id: c.id, title: c.title, subtitle: c.username ?? undefined, href: `/vault/${c.id}` });
          }),
      ),
    );
  }
  await Promise.all(tasks);
  return hits;
}
