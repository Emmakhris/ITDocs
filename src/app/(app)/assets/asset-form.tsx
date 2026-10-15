"use client";

import { useState } from "react";
import { ActionForm, Field, Submit } from "@/components/form";
import { Input, Select, Textarea, Card, STATUS_META, LinkButton } from "@/components/ui";
import { LocationSelect, RemotePicker, type LocationOpt, type Option } from "@/components/pickers";
import type { FieldDef } from "@/server/lib/custom-fields";
import type { ActionState } from "@/server/lib/forms";

export type AssetFormValues = { [k: string]: string | boolean | null | undefined | Record<string, unknown> } & {
  customFields?: Record<string, unknown>;
};
type TypeOpt = { id: string; name: string; isMedical: boolean; fieldDefs: FieldDef[] };

export function AssetForm({
  action,
  values = {},
  types,
  locations,
  departments,
  assignee,
  medicalModule,
  isEdit,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  values?: AssetFormValues;
  types: TypeOpt[];
  locations: LocationOpt[];
  departments: { id: string; name: string }[];
  assignee?: Option | null;
  medicalModule: boolean;
  isEdit?: boolean;
  cancelHref: string;
}) {
  const [typeId, setTypeId] = useState<string>((values.typeId as string) ?? "");
  const type = types.find((t) => t.id === typeId);
  const v = (k: string) => (values[k] as string | undefined) ?? "";
  const cf = values.customFields ?? {};

  return (
    <ActionForm action={action} className="space-y-4">
      <Card title="Identity">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Asset type" name="typeId" required>
            <Select id="typeId" name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Choose a type…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Name" name="name" required>
            <Input id="name" name="name" defaultValue={v("name")} placeholder="e.g. ICU Nurse Station PC 3" />
          </Field>
          <Field label="Asset tag" name="tag" hint={isEdit ? "Changing the tag invalidates printed labels" : "Leave blank to auto-generate"}>
            <Input id="tag" name="tag" defaultValue={v("tag")} className="font-mono" />
          </Field>
          <Field label="Status" name="status">
            <Select id="status" name="status" defaultValue={v("status") || "IN_STOCK"}>
              {Object.entries(STATUS_META)
                .filter(([k]) => k !== "DISPOSED")
                .map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
            </Select>
          </Field>
          <Field label="Manufacturer" name="manufacturer"><Input id="manufacturer" name="manufacturer" defaultValue={v("manufacturer")} /></Field>
          <Field label="Model" name="model"><Input id="model" name="model" defaultValue={v("model")} /></Field>
          <Field label="Serial number" name="serial"><Input id="serial" name="serial" defaultValue={v("serial")} className="font-mono" /></Field>
        </div>
      </Card>

      <Card title="Placement">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Location" name="locationId">
            <LocationSelect id="locationId" name="locationId" locations={locations} defaultValue={v("locationId")} />
          </Field>
          <Field label="Assigned to" name="assigneeId">
            <RemotePicker id="assigneeId" name="assigneeId" kind="people" initial={assignee} placeholder="Search people…" />
          </Field>
          <Field label="Department" name="departmentId">
            <Select id="departmentId" name="departmentId" defaultValue={v("departmentId")}>
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </Field>
          {isEdit && (
            <Field label="Reason for move (if placement or status changed)" name="changeReason" className="sm:col-span-2 lg:col-span-3">
              <Input id="changeReason" name="changeReason" placeholder="Recorded in the movement log" />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Network">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Hostname" name="hostname"><Input id="hostname" name="hostname" defaultValue={v("hostname")} className="font-mono" /></Field>
          <Field label="IP address" name="ipAddress"><Input id="ipAddress" name="ipAddress" defaultValue={v("ipAddress")} className="font-mono" /></Field>
          <Field label="MAC address" name="macAddress"><Input id="macAddress" name="macAddress" defaultValue={v("macAddress")} className="font-mono" /></Field>
          <Field label="Operating system" name="os"><Input id="os" name="os" defaultValue={v("os")} /></Field>
        </div>
      </Card>

      <Card title="Purchase & lifecycle">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Vendor / supplier" name="vendorName"><Input id="vendorName" name="vendorName" defaultValue={v("vendorName")} /></Field>
          <Field label="PO number" name="poNumber"><Input id="poNumber" name="poNumber" defaultValue={v("poNumber")} /></Field>
          <Field label="Purchase cost" name="purchaseCost"><Input id="purchaseCost" name="purchaseCost" inputMode="decimal" defaultValue={v("purchaseCost")} /></Field>
          <Field label="Purchase date" name="purchaseDate"><Input id="purchaseDate" type="date" name="purchaseDate" defaultValue={v("purchaseDate")} /></Field>
          <Field label="Warranty end" name="warrantyEnd"><Input id="warrantyEnd" type="date" name="warrantyEnd" defaultValue={v("warrantyEnd")} /></Field>
          <Field label="End of life / refresh" name="eolDate"><Input id="eolDate" type="date" name="eolDate" defaultValue={v("eolDate")} /></Field>
        </div>
      </Card>

      {type && type.fieldDefs.length > 0 && (
        <Card title={`${type.name} details`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {type.fieldDefs.map((d) => {
              const nm = `cf_${d.key}`;
              const dv = cf[d.key];
              return (
                <Field key={d.key} label={d.label} name={nm} hint={d.help} required={d.required} className={d.kind === "textarea" ? "sm:col-span-2 lg:col-span-3" : undefined}>
                  {d.kind === "select" ? (
                    <Select id={nm} name={nm} defaultValue={(dv as string) ?? ""}>
                      <option value="">—</option>
                      {d.options?.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </Select>
                  ) : d.kind === "boolean" ? (
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input type="checkbox" name={nm} defaultChecked={dv === true} className="h-4 w-4" /> Yes
                    </label>
                  ) : d.kind === "textarea" ? (
                    <Textarea id={nm} name={nm} defaultValue={(dv as string) ?? ""} />
                  ) : (
                    <Input
                      id={nm}
                      name={nm}
                      type={d.kind === "number" ? "number" : d.kind === "date" ? "date" : d.kind === "url" ? "url" : "text"}
                      step={d.kind === "number" ? "any" : undefined}
                      defaultValue={dv === undefined || dv === null ? "" : String(dv)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </Card>
      )}

      {medicalModule && type?.isMedical && (
        <Card title="Medical device">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="UDI / FDA device ID" name="udi"><Input id="udi" name="udi" defaultValue={v("udi")} className="font-mono" /></Field>
            <Field label="Risk class" name="riskClass">
              <Select id="riskClass" name="riskClass" defaultValue={v("riskClass")}>
                <option value="">—</option>
                <option>Class I</option>
                <option>Class II</option>
                <option>Class III</option>
              </Select>
            </Field>
            <Field label="Biomed owner" name="biomedOwner"><Input id="biomedOwner" name="biomedOwner" defaultValue={v("biomedOwner")} /></Field>
            <Field label="PM interval (days)" name="pmIntervalDays"><Input id="pmIntervalDays" type="number" name="pmIntervalDays" defaultValue={v("pmIntervalDays")} /></Field>
            <Field label="Last PM" name="lastPmDate"><Input id="lastPmDate" type="date" name="lastPmDate" defaultValue={v("lastPmDate")} /></Field>
            <Field label="Next PM" name="nextPmDate" hint="Auto-calculated from last PM + interval if blank"><Input id="nextPmDate" type="date" name="nextPmDate" defaultValue={v("nextPmDate")} /></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="networkSegmented" defaultChecked={values.networkSegmented === true} className="h-4 w-4" /> On segmented medical-device network
            </label>
          </div>
        </Card>
      )}

      {!medicalModule && type?.isMedical && (
        // Module switched off: keep existing medical values instead of clearing them on save
        <>
          {["udi", "riskClass", "biomedOwner", "pmIntervalDays", "lastPmDate", "nextPmDate"].map((k) => (
            <input key={k} type="hidden" name={k} value={v(k)} />
          ))}
          {values.networkSegmented === true && <input type="hidden" name="networkSegmented" value="on" />}
        </>
      )}

      <Card title="Notes & risk">
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input key={typeId} type="checkbox" name="storesPhi" defaultChecked={values.storesPhi === true || (!isEdit && !!type?.isMedical)} className="h-4 w-4" />
          Stores or transmits patient / sensitive data (PHI) — views are audited, wipe required on disposal
        </label>
        <Field label="Notes" name="notes"><Textarea id="notes" name="notes" defaultValue={v("notes")} rows={4} /></Field>
      </Card>

      <div className="flex gap-2">
        <Submit>{isEdit ? "Save changes" : "Create asset"}</Submit>
        <LinkButton href={cancelHref}>Cancel</LinkButton>
      </div>
    </ActionForm>
  );
}
