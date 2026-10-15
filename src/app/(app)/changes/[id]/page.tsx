import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { getChange } from "@/server/modules/changes";
import { CHANGE_ACTIONS, changeEditable, changeNo, decisionBlocker, duration, incidentNo, missingForSubmit, nextChangeStatus, type ChangeAction } from "@/server/lib/workflow";
import { NotFoundError } from "@/server/lib/errors";
import { renderMarkdown } from "@/lib/markdown";
import { db } from "@/server/db";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { RemotePicker } from "@/components/pickers";
import { Badge, Button, Card, DL, LinkButton, PageHeader, StatusBadge as AssetStatus, Textarea, fmtDateTime } from "@/components/ui";
import { linkAssetAction, saveChangeAction, transitionAction, unlinkAssetAction } from "../actions";
import { ChangeForm } from "../change-form";
import { CHANGE_TYPE, IncidentBadge, RISK, SeverityBadge, StatusBadge } from "../shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.changeRequest.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: c ? changeNo(c.number) : "Change" };
}

const BUTTON: Record<ChangeAction, { label: string; variant: "primary" | "secondary" | "danger" }> = {
  submit: { label: "Submit for approval", variant: "primary" },
  approve: { label: "Approve", variant: "primary" },
  reject: { label: "Reject", variant: "danger" },
  start: { label: "Start work", variant: "primary" },
  complete: { label: "Mark completed", variant: "primary" },
  fail: { label: "Mark failed", variant: "danger" },
  rollback: { label: "Rolled back", variant: "secondary" },
  cancel: { label: "Cancel change", variant: "secondary" },
  reopen: { label: "Reopen as draft", variant: "secondary" },
};

function Section({ title, md }: { title: string; md: string }) {
  if (!md.trim()) return null;
  return (
    <Card title={title}>
      <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
    </Card>
  );
}

export default async function ChangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const c = await getChange(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const writable = can(ctx.user.role, "changes", "write");
  const no = changeNo(c.number);

  if (sp.edit && writable && changeEditable(c.status))
    return (
      <>
        <PageHeader crumbs={[{ href: "/changes", label: "Changes" }, { href: `/changes/${id}`, label: no }]} title={`Edit ${no}`} />
        <ChangeForm action={saveChangeAction.bind(null, id)} values={c} cancelHref={`/changes/${id}`} submitted={c.status === "SUBMITTED"} />
      </>
    );

  // Which workflow buttons this person can use right now, and why others are blocked
  const missing = missingForSubmit(c);
  const actions = CHANGE_ACTIONS.filter((a) => nextChangeStatus(c, a)).map((a) => {
    const blocked =
      a === "approve" || a === "reject" ? decisionBlocker(c, ctx.user) : (a === "submit" || (a === "start" && c.status !== "APPROVED")) && missing.length ? `Add the ${missing.join(", ")} first.` : null;
    return { action: a, blocked };
  });
  const usable = actions.filter((a) => !a.blocked);
  const notes = [...new Set(actions.filter((a) => a.blocked).map((a) => a.blocked!))];

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/changes", label: "Changes" }]}
        title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{no}</span><span className="font-normal text-muted">·</span>{c.title}</span>}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge s={c.status} />
            <Badge tone={RISK[c.risk].tone}>{RISK[c.risk].label}</Badge>
            <span>{CHANGE_TYPE[c.type]}</span>
            {c.type === "EMERGENCY" && !c.approverId && c.status !== "DRAFT" && <Badge tone="red">Needs retrospective approval</Badge>}
          </span>
        }
        actions={writable && changeEditable(c.status) && <LinkButton href={`/changes/${id}?edit=1`}>Edit</LinkButton>}
      />

      {c.clashes.length > 0 && (
        <div className="mb-4 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn">
          <p className="font-medium">Other changes are scheduled in this window:</p>
          <ul className="mt-1 list-disc pl-5">
            {c.clashes.map((x) => (
              <li key={x.id}>
                <Link href={`/changes/${x.id}`} className="underline">{changeNo(x.number)} {x.title}</Link> ({fmtDateTime(x.plannedStart)} – {fmtDateTime(x.plannedEnd)}){x.sharesAssets && <strong> — affects the same equipment</strong>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {writable && actions.length > 0 && (
            <Card title="Next step">
              {usable.length > 0 && (
                <ActionForm action={transitionAction.bind(null, id)} className="space-y-3">
                  <Field label="Note" name="note" hint="Required to reject, fail or roll back. Recorded in the change history.">
                    <Textarea id="note" name="note" className="min-h-16" />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    {usable.map(({ action }) => (
                      <Button key={action} type="submit" name="action" value={action} variant={BUTTON[action].variant}>{BUTTON[action].label}</Button>
                    ))}
                  </div>
                </ActionForm>
              )}
              {notes.map((n) => <p key={n} className="mt-2 text-sm text-muted">{n}</p>)}
            </Card>
          )}
          <Section title="Why / description" md={c.description} />
          <Section title="Implementation plan" md={c.implementationPlan} />
          <Section title="Rollback plan" md={c.rollbackPlan} />
          <Section title="Test plan" md={c.testPlan} />
          {(c.decisionNote || c.outcomeNote) && (
            <Card title="Decision & outcome">
              <DL items={[["Approval note", c.decisionNote], ["Outcome", c.outcomeNote]]} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Schedule">
            <DL
              items={[
                ["Planned", c.plannedStart ? `${fmtDateTime(c.plannedStart)} – ${fmtDateTime(c.plannedEnd)}` : "Not scheduled"],
                ["Actual", c.actualStart ? `${fmtDateTime(c.actualStart)}${c.actualEnd ? ` – ${fmtDateTime(c.actualEnd)}` : " (in progress)"}` : null],
                ["Duration", c.actualStart && duration(c.actualStart, c.actualEnd)],
                ["Impact", c.impact],
              ]}
            />
          </Card>
          <Card title="People">
            <DL
              items={[
                ["Requested by", c.requesterName],
                ["Approved / rejected by", c.approverName && `${c.approverName}${c.decidedAt ? `, ${fmtDateTime(c.decidedAt)}` : ""}`],
                ["Ticket", c.ticketRef && <span className="font-mono">{c.ticketRef}</span>],
              ]}
            />
          </Card>

          {can(ctx.user.role, "assets", "read") && (
            <Card title={`Affected assets (${c.assets.length})`}>
              {c.assets.length ? (
                <ul className="space-y-1 text-sm">
                  {c.assets.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate text-brand hover:underline"><span className="font-mono">{a.tag}</span> {a.name}</Link>
                      <AssetStatus status={a.status} />
                      {writable && (
                        <ActionForm action={unlinkAssetAction.bind(null, "Change", id, a.id)}>
                          <ConfirmSubmit variant="secondary" message={`Remove ${a.tag} from this change?`}>✕</ConfirmSubmit>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">None linked.</p>
              )}
              {writable && (
                <ActionForm action={linkAssetAction.bind(null, "Change", id)} className="mt-3 space-y-2 border-t border-line pt-3">
                  <Field label="Add an affected asset" name="assetId"><RemotePicker name="assetId" kind="assets" /></Field>
                  <Submit variant="secondary">Add</Submit>
                </ActionForm>
              )}
            </Card>
          )}

          {c.incidents.length > 0 && (
            <Card title="Incidents caused">
              <ul className="space-y-1 text-sm">
                {c.incidents.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/incidents/${i.id}`} className="text-brand hover:underline"><span className="font-mono text-xs">{incidentNo(i.number)}</span> {i.title}</Link>
                    <SeverityBadge s={i.severity} />
                    <IncidentBadge s={i.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="History">
            <ol className="space-y-2 text-sm">
              {c.history.map((h) => (
                <li key={String(h.id)}>
                  <p>{h.summary}</p>
                  <p className="text-xs text-muted">{fmtDateTime(h.at)} · {h.actorName}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
