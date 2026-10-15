import type { SyncRun } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { db } from "@/server/db";
import { getRun, recentRuns, sourceStatus, type SyncSource } from "@/server/modules/sync";
import { listTokens } from "@/server/modules/api-tokens";
import { ActionForm, Field } from "@/components/form";
import { TokenList } from "@/components/token-list";
import { Badge, Button, Card, PageHeader, Select, Table, fmtDateTime } from "@/components/ui";
import { AdminNav } from "../admin-nav";
import { runSyncAction } from "./actions";

export const metadata = { title: "Integrations & API" };

const STATUS_TONE = { RUNNING: "blue", SUCCESS: "green", PARTIAL: "amber", FAILED: "red" } as const;
const SOURCE_LABEL: Record<SyncSource, string> = { ad: "Active Directory (people)", intune: "Microsoft Intune (devices)", sccm: "ConfigMgr / SCCM (devices)" };

function Stats({ run }: { run: SyncRun }) {
  const s = run.stats as Record<string, number>;
  return <span className="text-xs text-muted">{Object.entries(s).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(" · ") || "—"}</span>;
}

function RunButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" name="mode" value="preview" variant="secondary">Preview (dry run)</Button>
      <Button type="submit" name="mode" value="apply">Run sync</Button>
    </div>
  );
}

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "admin", "read");
  const sp = await searchParams;
  const [runs, tokens, types, selected] = await Promise.all([
    recentRuns(ctx),
    listTokens(ctx, true),
    db.assetType.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    sp.run ? getRun(ctx, sp.run) : null,
  ]);
  const status = sourceStatus();
  const details = (selected?.details ?? []) as Record<string, unknown>[];
  const typeSelect = (
    <Field label="Asset type for new devices" name="assetTypeId">
      <Select id="assetTypeId" name="assetTypeId" defaultValue="">
        <option value="">— Choose —</option>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>
    </Field>
  );

  return (
    <>
      <PageHeader title="Administration" />
      <AdminNav current="/admin/integrations" />

      {selected && (
        <Card title={`${selected.dryRun ? "Preview" : "Sync"}: ${SOURCE_LABEL[selected.source as SyncSource] ?? selected.source}`} className="mb-4" actions={<Badge tone={STATUS_TONE[selected.status]}>{selected.status.toLowerCase()}</Badge>}>
          <div id="run" className="space-y-3">
            <p className="text-sm">
              {fmtDateTime(selected.startedAt)} by {selected.triggeredBy} · <Stats run={selected} />
            </p>
            {selected.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{selected.error}</p>}
            {selected.dryRun && !selected.error && <p className="text-sm text-muted">Nothing was changed. Review the plan below, then run the sync to apply it.</p>}
            {details.length > 0 ? (
              <Table className="max-h-[28rem] overflow-y-auto border-0">
                <thead><tr><th>Action</th><th>Record</th><th>Details</th></tr></thead>
                <tbody>
                  {details.map((d, i) => (
                    <tr key={i}>
                      <td><Badge tone={d.action === "create" ? "green" : d.action === "deactivate" ? "red" : d.action === "unmatched" || d.action === "ambiguous" ? "amber" : "blue"}>{String(d.action)}</Badge></td>
                      <td className="font-mono text-xs">{String(d.tag ?? d.name ?? d.device ?? "")}</td>
                      <td className="text-xs text-muted">
                        {d.changes ? Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>).map(([k, c]) => `${k}: ${c.from ?? "—"} → ${c.to}`).join("; ") : null}
                        {[d.by && `matched by ${d.by}`, d.reason, d.email, d.department, d.serial && `serial ${d.serial}`, d.model, d.user && `user ${d.user}`, Array.isArray(d.candidates) && `matches ${(d.candidates as string[]).join(", ")}`].filter(Boolean).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              !selected.error && <p className="text-sm text-muted">No changes.</p>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Active Directory → people">
          <p className="mb-2 text-sm text-muted">Creates and updates people from the directory, links people entered by hand (by employee ID or email), and deactivates leavers. It never deletes anyone.</p>
          <p className="mb-3 text-xs"><Badge tone={status.ad.configured ? "green" : "gray"}>{status.ad.configured ? "Configured" : "Not configured"}</Badge> <span className="text-muted">{status.ad.detail}</span></p>
          {status.ad.configured && (
            <ActionForm action={runSyncAction.bind(null, "ad")} className="space-y-3">
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="force" className="h-4 w-4" /> Allow more than 20% of people to be deactivated</label>
              <RunButtons />
            </ActionForm>
          )}
        </Card>

        <Card title="Intune → devices">
          <p className="mb-2 text-sm text-muted">Matches managed devices to assets (link, then serial, then hostname). Updates hostname and OS, fills in missing make, model and serial, and records last check-in and compliance. Location and assignee are never changed.</p>
          <p className="mb-3 text-xs"><Badge tone={status.intune.configured ? "green" : "gray"}>{status.intune.configured ? "Configured" : "Not configured"}</Badge> <span className="text-muted">{status.intune.detail}</span></p>
          {status.intune.configured && (
            <ActionForm action={runSyncAction.bind(null, "intune")} className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="createMissing" className="h-4 w-4 accent-brand" /> Create assets for devices not in ITDocs</label>
              {typeSelect}
              <RunButtons />
            </ActionForm>
          )}
        </Card>

        <Card title="ConfigMgr (SCCM) → devices">
          <p className="mb-2 text-sm text-muted">Upload a CSV export with Name, SerialNumber, Manufacturer, Model, OperatingSystem, LastLogonUser and ResourceID. Raw view names such as Netbios_Name0 and SerialNumber0 also work. Matching is the same as Intune.</p>
          <ActionForm action={runSyncAction.bind(null, "sccm")} className="space-y-3">
            <Field label="CSV export" name="file">
              <input id="file" name="file" type="file" accept=".csv,text/csv" className="block w-full text-xs file:mr-2 file:rounded file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-xs" />
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="createMissing" className="h-4 w-4 accent-brand" /> Create assets for devices not in ITDocs</label>
            {typeSelect}
            <RunButtons />
          </ActionForm>
        </Card>
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold">Recent sync runs</h2>
      {runs.length ? (
        <Table>
          <thead><tr><th>Started</th><th>Source</th><th>Mode</th><th>Result</th><th>Counts</th><th>By</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className={r.id === selected?.id ? "bg-brand-soft/50" : undefined}>
                <td className="whitespace-nowrap text-xs"><a href={`/admin/integrations?run=${r.id}#run`} className="text-brand hover:underline">{fmtDateTime(r.startedAt)}</a></td>
                <td>{r.source.toUpperCase()}</td>
                <td>{r.dryRun ? "preview" : "sync"}</td>
                <td><Badge tone={STATUS_TONE[r.status]}>{r.status.toLowerCase()}</Badge>{r.error && <span className="block max-w-xs truncate text-xs text-muted" title={r.error}>{r.error}</span>}</td>
                <td><Stats run={r} /></td>
                <td className="text-xs">{r.triggeredBy}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-sm text-muted">No syncs yet.</p>
      )}
      <p className="mt-2 text-xs text-muted">Daily automatic syncs: set SYNC_AUTO=ad,intune in .env. They run after the digest hour set in Alerts.</p>

      <h2 className="mb-2 mt-6 text-sm font-semibold">All API tokens</h2>
      <Card>
        <p className="mb-3 text-sm text-muted">People create their own tokens on their profile page. Revoke anything unused or unknown. The API reference is at <a className="text-brand hover:underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>.</p>
        <TokenList tokens={tokens} showOwner back="/admin/integrations" />
      </Card>
    </>
  );
}
