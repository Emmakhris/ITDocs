import "server-only";
import type { Asset, AssetMovement, Prisma } from "@prisma/client";

// Public JSON shapes for /api/v1. Kept separate from database rows so internal columns can change
// without breaking API clients. Decimals become numbers, dates ISO strings (via JSON).

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

export function assetJson(
  a: Asset & { type?: { name: string } | null; location?: { id: string; name: string } | null; assignee?: { id: string; name: string } | null; locationPath?: string | null },
) {
  return {
    id: a.id,
    tag: a.tag,
    name: a.name,
    type: a.type ? { id: a.typeId, name: a.type.name } : { id: a.typeId },
    status: a.status,
    manufacturer: a.manufacturer,
    model: a.model,
    serial: a.serial,
    hostname: a.hostname,
    ipAddress: a.ipAddress,
    macAddress: a.macAddress,
    os: a.os,
    location: a.locationId ? { id: a.locationId, name: a.location?.name ?? null, path: a.locationPath ?? null } : null,
    assignee: a.assigneeId ? { id: a.assigneeId, name: a.assignee?.name ?? null } : null,
    departmentId: a.departmentId,
    vendorName: a.vendorName,
    purchaseDate: a.purchaseDate,
    purchaseCost: num(a.purchaseCost),
    poNumber: a.poNumber,
    warrantyEnd: a.warrantyEnd,
    eolDate: a.eolDate,
    medical: { udi: a.udi, riskClass: a.riskClass, biomedOwner: a.biomedOwner, pmIntervalDays: a.pmIntervalDays, lastPmDate: a.lastPmDate, nextPmDate: a.nextPmDate },
    storesPhi: a.storesPhi,
    networkSegmented: a.networkSegmented,
    customFields: a.customFields,
    notes: a.notes,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function movementJson(m: AssetMovement) {
  return {
    id: m.id,
    movedAt: m.movedAt,
    method: m.method,
    by: m.movedByName,
    from: { location: m.fromLocationPath, assignee: m.fromAssignee, status: m.fromStatus },
    to: { location: m.toLocationPath, assignee: m.toAssignee, status: m.toStatus },
    reason: m.reason,
    ticketRef: m.ticketRef,
  };
}

/** Editable asset fields from a stored row, in the shape assetInput accepts (for PATCH merges). */
export function assetEditable(a: Asset) {
  return {
    tag: a.tag,
    name: a.name,
    typeId: a.typeId,
    status: a.status,
    manufacturer: a.manufacturer ?? undefined,
    model: a.model ?? undefined,
    serial: a.serial ?? undefined,
    hostname: a.hostname ?? undefined,
    ipAddress: a.ipAddress ?? undefined,
    macAddress: a.macAddress ?? undefined,
    os: a.os ?? undefined,
    locationId: a.locationId ?? undefined,
    assigneeId: a.assigneeId ?? undefined,
    departmentId: a.departmentId ?? undefined,
    vendorName: a.vendorName ?? undefined,
    purchaseDate: a.purchaseDate ?? undefined,
    purchaseCost: a.purchaseCost === null ? undefined : Number(a.purchaseCost),
    poNumber: a.poNumber ?? undefined,
    warrantyEnd: a.warrantyEnd ?? undefined,
    eolDate: a.eolDate ?? undefined,
    udi: a.udi ?? undefined,
    riskClass: a.riskClass ?? undefined,
    biomedOwner: a.biomedOwner ?? undefined,
    pmIntervalDays: a.pmIntervalDays ?? undefined,
    lastPmDate: a.lastPmDate ?? undefined,
    nextPmDate: a.nextPmDate ?? undefined,
    storesPhi: a.storesPhi,
    networkSegmented: a.networkSegmented,
    notes: a.notes ?? undefined,
    customFields: (a.customFields ?? {}) as Record<string, unknown>,
  };
}
