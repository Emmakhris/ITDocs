import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { can } from "@/server/rbac/permissions";
import { describeParams, getReportDef, runReport } from "@/server/modules/reports";
import { listSubscriptions } from "@/server/modules/alerts";
import { getSettings } from "@/server/modules/settings";
import { NotFoundError } from "@/server/lib/errors";
import type { Cell } from "@/server/lib/xlsx";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { Button, Card, Empty, Input, LinkButton, PageHeader, Select, Table, fmtDate, fmtDateTime } from "@/components/ui";
import { sendNowAction, subscribeAction, unsubscribeAction } from "../actions";
import { PrintButton } from "../print-button";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const ctx = await requireCtx();
  try {
    return { title: getReportDef(ctx, (await params).key).title };
  } catch {
    return { title: "Report" };
  }
}

const SHOW = 500;

function show(v: Cell) {
  if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
  if (v instanceof Date) return <span className="whitespace-nowrap">{v.getHours() || v.getMinutes() ? fmtDateTime(v) : fmtDate(v)}</span>;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return <span className="tabular-nums">{v.toLocaleString()}</span>;
  return v;
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  const { key } = await params;
  const sp = await searchParams;
  const r = await runReport(ctx, key, sp).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [subs, settings] = await Promise.all([listSubscriptions(ctx, key), getSettings()]);
  const query = new URLSearchParams(Object.entries(r.params).map(([k, v]) => [k, String(v)])).toString();
  const canSchedule = can(ctx.user.role, "reports", "write");
  const paramText = describeParams(r.def, r.params);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/reports", label: "Reports" }]}
        title={r.def.title}
        subtitle={r.def.description}
        actions={
          <span className="no-print flex flex-wrap gap-2">
            <LinkButton href={`/api/reports/${key}?format=csv&${query}`} prefetch={false}><Download className="h-4 w-4" aria-hidden /> CSV</LinkButton>
            <LinkButton href={`/api/reports/${key}?format=xlsx&${query}`} prefetch={false}><Download className="h-4 w-4" aria-hidden /> Excel</LinkButton>
            <PrintButton />
          </span>
        }
      />

      {r.def.params.length > 0 && (
        <form className="no-print mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
          {r.def.params.map((p) => (
            <label key={p.name} className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">{p.label}</span>
              <Select name={p.name} defaultValue={String(r.params[p.name])} className="min-w-40">
                {p.type === "days" ? p.options.map((o) => <option key={o} value={o}>{o === 0 ? "Already due" : `${o} days`}</option>) : p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </label>
          ))}
          <Button variant="secondary">Update</Button>
        </form>
      )}

      <p className="mb-2 text-sm">
        <strong>{r.summary ?? `${r.rows.length} rows`}</strong>
        <span className="text-muted">{paramText && ` · ${paramText}`} · generated {fmtDateTime(new Date())}{r.rows.length > SHOW && ` · showing the first ${SHOW}; export for all ${r.rows.length}`}</span>
      </p>

      {r.rows.length === 0 ? (
        <Empty title="Nothing to report">No records match these settings.</Empty>
      ) : (
        <Table className="print:overflow-visible print:border-0">
          <thead><tr>{r.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {r.rows.slice(0, SHOW).map((row, i) => (
              <tr key={i}>{row.map((v, j) => <td key={j}>{show(v)}</td>)}</tr>
            ))}
          </tbody>
        </Table>
      )}

      <div className="no-print mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Email this report on a schedule">
          {canSchedule ? (
            <ActionForm action={subscribeAction.bind(null, key, r.params)} className="space-y-3">
              <p className="text-xs text-muted">Uses the current settings{paramText && ` (${paramText})`}. Sent after {String(settings.digestHour).padStart(2, "0")}:00 server time — change the hour in Admin › Alerts.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="How often" name="frequency">
                  <Select id="frequency" name="frequency" defaultValue="WEEKLY"><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></Select>
                </Field>
                <Field label="Format" name="format">
                  <Select id="format" name="format" defaultValue="XLSX"><option value="XLSX">Excel</option><option value="CSV">CSV</option></Select>
                </Field>
                <Field label="Send to" name="recipients" className="sm:col-span-2" hint="Comma-separated email addresses"><Input id="recipients" name="recipients" placeholder="it-managers@example.org" /></Field>
              </div>
              <Submit>Schedule</Submit>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Technicians and admins can schedule reports.</p>
          )}
        </Card>
        <Card title={`Schedules for this report (${subs.length})`}>
          {subs.length ? (
            <ul className="divide-y divide-line text-sm">
              {subs.map((s) => (
                <li key={s.id} className="space-y-1 py-2">
                  <p><strong>{s.frequency.toLowerCase()}</strong> as {s.format} to {s.recipients.join(", ")}</p>
                  <p className="text-xs text-muted">Next {fmtDateTime(s.nextRunAt)}{s.lastSentAt && ` · last ${fmtDateTime(s.lastSentAt)}`} · set up by {s.createdBy}</p>
                  {canSchedule && (
                    <div className="flex gap-2">
                      <ActionForm action={sendNowAction.bind(null, s.id)}><Submit variant="secondary">Send now</Submit></ActionForm>
                      <ActionForm action={unsubscribeAction.bind(null, key, s.id)}><ConfirmSubmit message="Stop sending this report?">Remove</ConfirmSubmit></ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Not scheduled.</p>
          )}
        </Card>
      </div>
    </>
  );
}
