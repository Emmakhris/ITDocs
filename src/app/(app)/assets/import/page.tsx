import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { Card, PageHeader } from "@/components/ui";
import { Importer } from "./importer";

export const metadata = { title: "Import assets" };

export default async function ImportPage() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "assets", "write");
  return (
    <>
      <PageHeader title="Import assets from CSV" crumbs={[{ href: "/assets", label: "Assets" }]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Importer />
        </div>
        <Card title="File format">
          <div className="space-y-2 text-sm">
            <p>Use the same columns as <strong>Export CSV</strong> — the easiest start is to export, edit in Excel, and re-import.</p>
            <p><strong>Required:</strong> <code>type</code> (an existing asset type name) and <code>name</code> (or manufacturer/model).</p>
            <p><strong>Rows with an existing tag update that asset;</strong> rows without a tag get a new one.</p>
            <p><code>location</code> may be a full path (<em>Main Campus › Tower A › ICU</em>), a location code, or a unique name.</p>
            <p><code>assignee</code> is matched by name or employee ID; <code>assigneeEmail</code> by email.</p>
            <p>Custom fields use <code>cf_&lt;key&gt;</code> columns, e.g. <code>cf_ram_gb</code>.</p>
            <p>Intune, SCCM and AD exports can be imported after renaming columns to match. Direct connectors come in phase 9.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
