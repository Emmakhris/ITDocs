import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { getAsset } from "@/server/modules/assets";
import { NotFoundError } from "@/server/lib/errors";
import { PageHeader, toDateInput } from "@/components/ui";
import { AssetForm } from "../../asset-form";
import { assetFormData } from "../../form-data";
import { updateAssetAction } from "../../actions";

export const metadata = { title: "Edit asset" };

export default async function EditAsset({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "assets", "write");
  const { id } = await params;
  const a = await getAsset(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const values = {
    tag: a.tag, name: a.name, typeId: a.typeId, status: a.status,
    manufacturer: a.manufacturer, model: a.model, serial: a.serial,
    hostname: a.hostname, ipAddress: a.ipAddress, macAddress: a.macAddress, os: a.os,
    locationId: a.locationId, departmentId: a.departmentId,
    vendorName: a.vendorName, poNumber: a.poNumber, purchaseCost: a.purchaseCost?.toString(),
    purchaseDate: toDateInput(a.purchaseDate), warrantyEnd: toDateInput(a.warrantyEnd), eolDate: toDateInput(a.eolDate),
    udi: a.udi, riskClass: a.riskClass, biomedOwner: a.biomedOwner, pmIntervalDays: a.pmIntervalDays?.toString(),
    lastPmDate: toDateInput(a.lastPmDate), nextPmDate: toDateInput(a.nextPmDate),
    storesPhi: a.storesPhi, networkSegmented: a.networkSegmented, notes: a.notes,
    customFields: a.customFields as Record<string, unknown>,
  };
  return (
    <>
      <PageHeader title={`Edit ${a.tag}`} subtitle={a.name} crumbs={[{ href: "/assets", label: "Assets" }, { href: `/assets/${a.id}`, label: a.tag }]} />
      <AssetForm
        action={updateAssetAction.bind(null, a.id)}
        values={values}
        assignee={a.assignee ? { id: a.assignee.id, label: a.assignee.name } : null}
        isEdit
        cancelHref={`/assets/${a.id}`}
        {...await assetFormData()}
      />
    </>
  );
}
