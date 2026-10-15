import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { PageHeader } from "@/components/ui";
import { AssetForm } from "../asset-form";
import { assetFormData } from "../form-data";
import { createAssetAction } from "../actions";

export const metadata = { title: "New asset" };

export default async function NewAsset({ searchParams }: { searchParams: Promise<{ typeId?: string; locationId?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "assets", "write");
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="New asset" crumbs={[{ href: "/assets", label: "Assets" }]} />
      <AssetForm action={createAssetAction} values={{ typeId: sp.typeId, locationId: sp.locationId }} cancelHref="/assets" {...await assetFormData()} />
    </>
  );
}
