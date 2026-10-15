import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { getSettings } from "@/server/modules/settings";
import { buildDigest, emailConfigured, recentDeliveries, teamsConfigured } from "@/server/modules/alerts";
import { ActionForm, Field, Submit } from "@/components/form";
import { Badge, Card, Input, PageHeader, Select, Table, fmtDateTime } from "@/components/ui";
import { AdminNav } from "../admin-nav";
import { runNowAction, saveAlertSettingsAction, testAction } from "./actions";

export const metadata = { title: "Alerts" };

const STATUS_TONE = { SENT: "green", FAILED: "red", SKIPPED: "gray" } as const;

export default async function AlertsAdmin() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "admin", "read");
  const [s, log, preview] = await Promise.all([getSettings(), recentDeliveries(ctx), buildDigest()]);
  const email = emailConfigured();
  const teams = teamsConfigured();
  const smtpLog = process.env.SMTP_HOST === "log";

  return (
    <>
      <PageHeader title="Administration" />
      <AdminNav current="/admin/alerts" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Channels">
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <Badge tone={email ? (smtpLog ? "amber" : "green") : "gray"}>{email ? (smtpLog ? "Log only" : "Configured") : "Not configured"}</Badge>
              <span>
                <strong>Email</strong>{" "}
                {email ? (smtpLog ? "— SMTP_HOST=log: messages are recorded below but not delivered." : `— via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}, from ${process.env.SMTP_FROM || "(default)"}`) : "— set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in .env and restart."}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <Badge tone={teams ? "green" : "gray"}>{teams ? "Configured" : "Not configured"}</Badge>
              <span><strong>Microsoft Teams</strong> {teams ? "— posts to the channel webhook in TEAMS_WEBHOOK_URL." : "— create a Workflows “post to a channel when a webhook request is received” flow (or an incoming webhook) and put its URL in TEAMS_WEBHOOK_URL."}</span>
            </li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <ActionForm action={testAction.bind(null, "email")}><Submit variant="secondary">Send test email</Submit></ActionForm>
            <ActionForm action={testAction.bind(null, "teams")}><Submit variant="secondary">Send test to Teams</Submit></ActionForm>
          </div>
        </Card>

        <Card title="What gets sent">
          <ActionForm action={saveAlertSettingsAction} className="space-y-4">
            <Field label="Email recipients" name="alertRecipients" hint="Comma-separated, e.g. a shared IT mailbox">
              <Input id="alertRecipients" name="alertRecipients" defaultValue={s.alertRecipients} placeholder="it-alerts@example.org" />
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="digestEnabled" defaultChecked={s.digestEnabled} className="mt-0.5 h-4 w-4 accent-brand" />
              <span><strong>Daily digest</strong><span className="block text-muted">Open incidents, approvals waiting, today&apos;s change windows, overdue check-outs, contract deadlines, over-allocated licences, warranties, maintenance and reviews due. Skipped on days with nothing to report.</span></span>
            </label>
            <Field label="Send the digest (and scheduled reports) after" name="digestHour">
              <Select id="digestHour" name="digestHour" defaultValue={String(s.digestHour)} className="max-w-40">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </Select>
            </Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="incidentAlerts" defaultChecked={s.incidentAlerts} className="mt-0.5 h-4 w-4 accent-brand" />
              <span><strong>Immediate P1/P2 incident alerts</strong><span className="block text-muted">Sent when a P1 or P2 incident is opened, or an incident is escalated to P1/P2.</span></span>
            </label>
            <Submit>Save</Submit>
          </ActionForm>
        </Card>

        <Card title={`Today's digest would contain ${preview.total} item${preview.total === 1 ? "" : "s"}`} className="lg:col-span-2">
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {preview.sections.filter((x) => x.items.length).map((x) => (
              <li key={x.title} className="flex justify-between gap-2"><span>{x.title}</span><span className="tabular-nums text-muted">{x.items.length + (x.more ?? 0)}</span></li>
            ))}
            {preview.total === 0 && <li className="text-muted">Nothing needs attention right now.</li>}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <ActionForm action={runNowAction.bind(null, "digest")}><Submit variant="secondary">Send digest now</Submit></ActionForm>
            <ActionForm action={runNowAction.bind(null, "scheduled")}><Submit variant="secondary">Run scheduled jobs now</Submit></ActionForm>
          </div>
          <p className="mt-2 text-xs text-muted">The scheduler runs inside the app every 5 minutes. Set ALERTS_SCHEDULER=off on extra instances if you prefer one sender (duplicates are prevented either way).</p>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Delivery log (latest 50)</h2>
      {log.length === 0 ? (
        <p className="text-sm text-muted">Nothing sent yet.</p>
      ) : (
        <Table>
          <thead><tr><th>When</th><th>Channel</th><th>Type</th><th>Subject</th><th>To</th><th>Result</th></tr></thead>
          <tbody>
            {log.map((d) => (
              <tr key={d.id}>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(d.at)}</td>
                <td>{d.channel === "EMAIL" ? "Email" : "Teams"}</td>
                <td>{d.kind}</td>
                <td className="max-w-md">{d.subject}</td>
                <td className="max-w-xs break-words text-xs">{d.recipients}</td>
                <td><Badge tone={STATUS_TONE[d.status]}>{d.status.toLowerCase()}</Badge>{d.error && <span className="block text-xs text-muted">{d.error}</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
