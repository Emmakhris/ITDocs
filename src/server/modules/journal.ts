import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit, diff } from "../audit/log";
import { assertCan } from "../rbac/permissions";
import { AppError, ForbiddenError, NotFoundError } from "../lib/errors";
import { checkbox, optDate } from "../lib/forms";
import type { Ctx } from "../context";

// Daily tech journal / on-call log: short timestamped notes grouped by day. Authors can edit or
// delete their own entries for 24 hours (admins can delete any); after that the record stands.

export const EDIT_WINDOW_MS = 24 * 3600_000;

const tagList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => [...new Set((Array.isArray(v) ? v : (v ?? "").split(",")).map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))].slice(0, 10));

export const journalInput = z.object({
  text: z.string().trim().min(1, "Write something").max(10_000),
  tags: tagList,
  onCall: checkbox,
  at: optDate,
});

/** Local-time day boundaries for "YYYY-MM-DD" (server time zone). */
export function dayRange(day: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1) };
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function listJournal(ctx: Ctx, f: { day?: string; q?: string; tag?: string; authorId?: string; onCall?: boolean } = {}) {
  assertCan(ctx.user.role, "changes", "read");
  const and: Prisma.JournalEntryWhereInput[] = [{ deletedAt: null }];
  const searching = !!(f.q || f.tag || f.authorId || f.onCall);
  const range = dayRange(f.day ?? dayKey(new Date()));
  if (!searching && range) and.push({ at: { gte: range.start, lt: range.end } });
  if (f.q?.trim()) and.push({ text: { contains: f.q.trim(), mode: "insensitive" } });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.authorId) and.push({ authorId: f.authorId });
  if (f.onCall) and.push({ onCall: true });
  const rows = await db.journalEntry.findMany({ where: { AND: and }, orderBy: { at: searching ? "desc" : "asc" }, take: 500 });
  const now = Date.now();
  return rows.map((e) => ({ ...e, editable: e.authorId === ctx.user.id && now - e.createdAt.getTime() < EDIT_WINDOW_MS }));
}

/** Days around `day` that have entries, for the calendar strip. */
export async function journalDays(ctx: Ctx, day: string) {
  assertCan(ctx.user.role, "changes", "read");
  const r = dayRange(day) ?? dayRange(dayKey(new Date()))!;
  const from = new Date(r.start.getFullYear(), r.start.getMonth(), r.start.getDate() - 13);
  const rows = await db.journalEntry.findMany({ where: { deletedAt: null, at: { gte: from, lt: r.end } }, select: { at: true, onCall: true } });
  const counts = new Map<string, { n: number; onCall: number }>();
  for (const e of rows) {
    const k = dayKey(e.at);
    const c = counts.get(k) ?? { n: 0, onCall: 0 };
    c.n++;
    if (e.onCall) c.onCall++;
    counts.set(k, c);
  }
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i + 1);
    const k = dayKey(d);
    return { day: k, date: d, ...(counts.get(k) ?? { n: 0, onCall: 0 }) };
  });
}

export async function addJournalEntry(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "changes", "write");
  const d = journalInput.parse(input);
  const now = Date.now();
  // Back-dating is allowed for things logged after the fact, but not into the future or the distant past
  if (d.at && (d.at.getTime() > now + 5 * 60_000 || d.at.getTime() < now - 7 * 86_400_000)) throw new AppError("The time must be within the last 7 days.");
  return db.$transaction(async (tx) => {
    const e = await tx.journalEntry.create({ data: { text: d.text, tags: d.tags, onCall: d.onCall, at: d.at ?? new Date(), authorId: ctx.user.id, authorName: ctx.user.displayName } });
    await audit(tx, ctx, { action: "create", entityType: "JournalEntry", entityId: e.id, summary: `Journal${e.onCall ? " (on-call)" : ""}: ${e.text.slice(0, 80)}` });
    return e;
  });
}

async function ownEntry(ctx: Ctx, id: string, allowAdmin: boolean) {
  const e = await db.journalEntry.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw new NotFoundError("Journal entry");
  const isAuthor = e.authorId === ctx.user.id;
  if (allowAdmin && ctx.user.role === "ADMIN" && !isAuthor) return e;
  if (!isAuthor) throw new ForbiddenError("You can only change your own journal entries.");
  if (Date.now() - e.createdAt.getTime() >= EDIT_WINDOW_MS) throw new AppError("Entries can only be changed for 24 hours. Add a new entry to correct it.");
  return e;
}

export async function updateJournalEntry(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx.user.role, "changes", "write");
  const d = journalInput.parse(input);
  const before = await ownEntry(ctx, id, false);
  return db.$transaction(async (tx) => {
    const after = await tx.journalEntry.update({ where: { id }, data: { text: d.text, tags: d.tags, onCall: d.onCall, at: d.at ?? before.at } });
    const df = diff(before, after);
    if (df.changed.length) await audit(tx, ctx, { action: "update", entityType: "JournalEntry", entityId: id, summary: "Edited journal entry", before: df.before, after: df.after });
    return after;
  });
}

export async function deleteJournalEntry(ctx: Ctx, id: string) {
  assertCan(ctx.user.role, "changes", "write");
  const e = await ownEntry(ctx, id, true);
  await db.$transaction(async (tx) => {
    await tx.journalEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, ctx, { action: "delete", entityType: "JournalEntry", entityId: id, summary: `Deleted journal entry by ${e.authorName}`, before: { text: e.text, at: e.at } });
  });
  return dayKey(e.at);
}

export async function journalTags() {
  const rows = await db.$queryRaw<{ tag: string; n: bigint }[]>(Prisma.sql`
    SELECT t AS tag, count(*) AS n FROM "JournalEntry", unnest(tags) AS t
    WHERE "deletedAt" IS NULL AND at > now() - interval '90 days' GROUP BY t ORDER BY n DESC LIMIT 20`);
  return rows.map((r) => ({ tag: r.tag, count: Number(r.n) }));
}
