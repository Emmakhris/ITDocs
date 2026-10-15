import Link from "next/link";
import { notFound } from "next/navigation";
import type { IncidentStatus } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getIncident, ownerOptions } from "@/server/modules/incidents";
import { changeOptions } from "@/server/modules/changes";
import { changeNo, duration, incidentNo, incidentStatusChange } from "@/server/lib/workflow";
import { NotFoundError } from "@/server/lib/errors";
import { renderMarkdown } from "@/lib/markdown";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { Button, Card, DL, Input, LinkButton, PageHeader, StatusBadge as AssetStatus, Textarea, cx, fmtDateTime } from "@/components/ui";
import { incidentStatusAction, incidentUpdateAction, linkAssetAction, saveIncidentAction, unlinkAssetAction } from "../../actions";
import { INCIDENT_STATUS, IncidentBadge, SEVERITY, SeverityBadge, StatusBadge } from "../../shared";
import { IncidentForm } from "../incident-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const i = await db.incident.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: i ? incidentNo(i.number) : "Incident" };
}

const KIND_DOT: Record<string, string> = { status: "bg-brand", severity: "bg-danger", owner: "bg-warn", note: "bg-muted" };

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const i = await getIncident(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "changes", "write");
  const no = incidentNo(i.number);

  if (sp.edit && writable) {
    const [owners, changes] = await Promise.all([ownerOptions(), changeOptions()]);
    return (
      <>
        <PageHeader crumbs={[{ href: "/changes/incidents", label: "Incidents" }, { href: `/changes/incidents/${id}`, label: no }]} title={`Edit ${no}`} />
        <IncidentForm action={saveIncidentAction.bind(null, id)} values={i} owners={owners} changes={changes} cancelHref={`/changes/incidents/${id}`} editing />
      </>
    );
  }

  // Status buttons: what's possible from here, and what's still missing for the rest
  const targets = (Object.keys(INCIDENT_STATUS) as IncidentStatus[]).filter((s) => s !== i.status).map((s) => ({ s, r: incidentStatusChange(i, s) }));
  const possible = targets.filter((t) => "set" in t.r);
  // Only "resolve" and "close" have prerequisites worth explaining
  const blockers = [...new Set(targets.flatMap((t) => ((t.s === "RESOLVED" || t.s === "CLOSED") && "error" in t.r && !/only be reopened/.test(t.r.error) ? [t.r.error] : [])))];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/changes/incidents", label: "Incidents" }]}
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{no}</span><span className="font-normal text-muted">·</span>{i.title}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge s={i.severity} />
            <IncidentBadge s={i.status} />
            <span>{SEVERITY[i.severity].hint}</span>
          </span>
        }
        actions={writable && <LinkButton href={`/changes/incidents/${id}?edit=1`} variant="primary">Edit / record cause</LinkButton>}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {writable && (
            <Card title="Update status">
              {possible.length > 0 && (
                <ActionForm action={incidentStatusAction.bind(null, id)} className="space-y-3">
                  <Field label="Comment (optional)" name="comment"><Input id="comment" name="comment" placeholder="e.g. Failed over to node B" /></Field>
                  <div className="flex flex-wrap gap-2">
                    {possible.map(({ s }) => (
                      <Button key={s} type="submit" name="status" value={s} variant={s === "RESOLVED" || s === "CLOSED" ? "primary" : "secondary"}>
                        {s === "INVESTIGATING" && (i.status === "RESOLVED" || i.status === "CLOSED") ? "Reopen" : `Mark ${INCIDENT_STATUS[s].label.toLowerCase()}`}
                      </Button>
                    ))}
                  </div>
                </ActionForm>
              )}
              {blockers.map((b) => <p key={b} className="mt-2 text-sm text-muted">{b} <Link href={`/changes/incidents/${id}?edit=1`} className="text-brand hover:underline">Edit</Link></p>)}
            </Card>
          )}

          {i.description.trim() && (
            <Card title="What happened">
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(i.description) }} />
            </Card>
          )}

          <Card title={`Timeline (${i.updates.length})`}>
            <ol id="timeline" className="relative space-y-3 border-l border-line pl-5">
              {i.updates.map((u) => (
                <li key={u.id} className="relative">
                  <span className={cx("absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface", KIND_DOT[u.kind] ?? "bg-muted")} aria-hidden />
                  <p className={cx("whitespace-pre-wrap text-sm", u.kind !== "note" && "font-medium")}>{u.text}</p>
                  <p className="text-xs text-muted">{fmtDateTime(u.at)} · {u.authorName}</p>
                </li>
              ))}
            </ol>
            {writable && (
              <ActionForm action={incidentUpdateAction.bind(null, id)} className="mt-4 space-y-2 border-t border-line pt-4" resetOnSuccess>
                <Field label="Add an update" name="text"><Textarea id="text" name="text" className="min-h-20" placeholder="What you checked, who you called, what changed…" /></Field>
                <Submit>Post update</Submit>
              </ActionForm>
            )}
          </Card>

          {(i.resolution || i.rootCause || i.followUp) && (
            <Card title="Resolution & root cause">
              <DL items={[["Resolution", i.resolution && <span className="whitespace-pre-wrap">{i.resolution}</span>], ["Root cause", i.rootCause && <span className="whitespace-pre-wrap">{i.rootCause}</span>], ["Follow-up", i.followUp && <span className="whitespace-pre-wrap">{i.followUp}</span>]]} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Timing">
            <DL
              items={[
                ["Started", fmtDateTime(i.startedAt)],
                ["Mitigated", i.mitigatedAt && `${fmtDateTime(i.mitigatedAt)} (${duration(i.startedAt, i.mitigatedAt)})`],
                ["Resolved", i.resolvedAt && `${fmtDateTime(i.resolvedAt)} (${duration(i.startedAt, i.resolvedAt)})`],
                ["Closed", fmtDateTime(i.closedAt)],
              ]}
            />
          </Card>
          <Card title="Ownership & cause">
            <DL
              items={[
                ["Owner", i.owner?.displayName],
                ["Impact", i.impact],
                ["Caused by", i.causedByChange && (
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/${i.causedByChange.id}`} className="text-brand hover:underline">{changeNo(i.causedByChange.number)} {i.causedByChange.title}</Link>
                    <StatusBadge s={i.causedByChange.status} />
                  </span>
                )],
                ["Ticket", i.ticketRef && <span className="font-mono">{i.ticketRef}</span>],
                ["Reported by", i.createdBy],
              ]}
            />
          </Card>
          {can(ctx.user.role, "assets", "read") && (
            <Card title={`Affected assets (${i.assets.length})`}>
              {i.assets.length ? (
                <ul className="space-y-1 text-sm">
                  {i.assets.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate text-brand hover:underline"><span className="font-mono">{a.tag}</span> {a.name}</Link>
                      <AssetStatus status={a.status} />
                      {writable && (
                        <ActionForm action={unlinkAssetAction.bind(null, "Incident", id, a.id)}>
                          <ConfirmSubmit variant="secondary" message={`Remove ${a.tag}?`}>✕</ConfirmSubmit>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">None linked.</p>
              )}
              {writable && (
                <ActionForm action={linkAssetAction.bind(null, "Incident", id)} className="mt-3 space-y-2 border-t border-line pt-3">
                  <Field label="Add an affected asset" name="assetId"><RemotePicker name="assetId" kind="assets" /></Field>
                  <Submit variant="secondary">Add</Submit>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
