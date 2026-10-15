"use server";

import { redirect } from "next/navigation";
import type { IncidentStatus } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { formToObject, toActionError, type ActionState } from "@/server/lib/forms";
import { AppError } from "@/server/lib/errors";
import { CHANGE_ACTIONS, type ChangeAction } from "@/server/lib/workflow";
import { createChange, linkAffected, transitionChange, unlinkAffected, updateChange } from "@/server/modules/changes";
import { addIncidentUpdate, createIncident, setIncidentStatus, updateIncident } from "@/server/modules/incidents";
import { addJournalEntry, deleteJournalEntry, updateJournalEntry } from "@/server/modules/journal";
import type { Ctx } from "@/server/context";

/** Runs a write and redirects to the returned path; errors come back to the form. */
async function run(fn: (ctx: Ctx) => Promise<string>): Promise<ActionState> {
  let target: string;
  try {
    target = await fn(await requireCtx());
  } catch (e) {
    return toActionError(e);
  }
  redirect(target);
}

const longFields = ["description", "implementationPlan", "rollbackPlan", "testPlan"];
/** formToObject trims; keep Markdown fields' own whitespace. */
function changeForm(fd: FormData) {
  const o = formToObject(fd);
  for (const k of longFields) o[k] = String(fd.get(k) ?? "");
  return o;
}

export const saveChangeAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => `/changes/${(id ? await updateChange(ctx, id, changeForm(fd)) : await createChange(ctx, changeForm(fd))).id}`);

export const transitionAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const action = String(fd.get("action") ?? "") as ChangeAction;
    if (!CHANGE_ACTIONS.includes(action)) throw new AppError("Unknown action.");
    await transitionChange(ctx, id, action, String(fd.get("note") ?? ""));
    return `/changes/${id}`;
  });

export const linkAssetAction = async (kind: "Change" | "Incident", id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await linkAffected(ctx, kind, id, String(fd.get("assetId") ?? "")), kind === "Change" ? `/changes/${id}` : `/changes/incidents/${id}`));
export const unlinkAssetAction = async (kind: "Change" | "Incident", id: string, assetId: string, _: ActionState) =>
  run(async (ctx) => (await unlinkAffected(ctx, kind, id, assetId), kind === "Change" ? `/changes/${id}` : `/changes/incidents/${id}`));

export const saveIncidentAction = async (id: string | null, _: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const o = formToObject(fd);
    o.description = String(fd.get("description") ?? "");
    return `/changes/incidents/${(id ? await updateIncident(ctx, id, o) : await createIncident(ctx, o)).id}`;
  });
export const incidentUpdateAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await addIncidentUpdate(ctx, id, String(fd.get("text") ?? "")), `/changes/incidents/${id}#timeline`));
export const incidentStatusAction = async (id: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => (await setIncidentStatus(ctx, id, String(fd.get("status")) as IncidentStatus, String(fd.get("comment") ?? "")), `/changes/incidents/${id}`));

export const journalAction = async (id: string | null, day: string, _: ActionState, fd: FormData) =>
  run(async (ctx) => {
    const e = id ? await updateJournalEntry(ctx, id, formToObject(fd)) : await addJournalEntry(ctx, formToObject(fd));
    const d = e.at;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `/changes/journal?day=${id ? day : key}#e-${e.id}`;
  });
export const deleteJournalAction = async (id: string, _: ActionState) => run(async (ctx) => `/changes/journal?day=${await deleteJournalEntry(ctx, id)}`);
