import "server-only";
import { listAssetTypes } from "@/server/modules/asset-types";
import { locationTree } from "@/server/modules/locations";
import { listDepartments } from "@/server/modules/people";
import { getSettings } from "@/server/modules/settings";

/** Reference data the asset form needs (serialisable for client components). */
export async function assetFormData() {
  const [types, locations, departments, settings] = await Promise.all([listAssetTypes(), locationTree(), listDepartments(), getSettings()]);
  return {
    types: types.map((t) => ({ id: t.id, name: t.name, isMedical: t.isMedical, fieldDefs: t.fieldDefs })),
    locations: locations.map((l) => ({ id: l.id, name: l.name, path: l.path, depth: l.depth })),
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    medicalModule: settings.medicalModule,
  };
}
