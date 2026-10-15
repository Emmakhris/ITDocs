import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { getAssetType, listAssetTypes } from "@/server/modules/asset-types";
import { Badge, LinkButton, PageHeader, Table } from "@/components/ui";
import { AdminNav } from "../admin-nav";
import { TypeEditor } from "./type-editor";
import { deleteAssetTypeAction, saveAssetTypeAction } from "../actions";

export const metadata = { title: "Asset types" };

export default async function TypesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "admin", "read");
  const { edit } = await searchParams;
  const types = await listAssetTypes();

  if (edit) {
    const t = edit === "new" ? null : await getAssetType(edit);
    return (
      <>
        <PageHeader title={t ? `Edit type: ${t.name}` : "New asset type"} crumbs={[{ href: "/admin/types", label: "Asset types" }]} />
        <TypeEditor
          action={saveAssetTypeAction.bind(null, t?.id ?? null)}
          deleteAction={t ? deleteAssetTypeAction.bind(null, t.id) : undefined}
          values={t ? { name: t.name, icon: t.icon, tagPrefix: t.tagPrefix, isMedical: t.isMedical, fieldDefs: t.fieldDefs } : undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Administration" actions={<LinkButton href="/admin/types?edit=new" variant="primary">New asset type</LinkButton>} />
      <AdminNav current="/admin/types" />
      <p className="mb-3 text-sm text-muted">
        Asset types define which extra fields appear on an asset — e.g. an <em>Infusion Pump</em> can carry a drug-library version, a <em>Laptop</em> its RAM.
      </p>
      <Table>
        <thead><tr><th>Type</th><th>Tag prefix</th><th>Custom fields</th><th>Assets</th></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <td>
                <Link className="text-brand hover:underline" href={`/admin/types?edit=${t.id}`}>{t.name}</Link>
                {t.isMedical && <Badge tone="red" className="ml-1.5">medical</Badge>}
              </td>
              <td className="font-mono text-xs">{t.tagPrefix ?? "default"}</td>
              <td className="text-xs text-muted">{t.fieldDefs.map((f) => f.label).join(", ") || "—"}</td>
              <td className="tabular-nums">{t._count.assets}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
