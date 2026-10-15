"use client";

import { ActionForm, Field, Submit } from "@/components/form";
import { Card, Input } from "@/components/ui";
import type { AppSettings } from "@/server/modules/settings";
import { saveSettingsAction } from "./actions";

export function SettingsForm({ values }: { values: AppSettings }) {
  return (
    <ActionForm action={saveSettingsAction} className="max-w-2xl space-y-4">
      <Card title="Organisation">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name" name="orgName" required><Input id="orgName" name="orgName" defaultValue={values.orgName} /></Field>
          <Field label="Default asset tag prefix" name="assetTagPrefix" hint="Types can override (e.g. BIO- for biomed)"><Input id="assetTagPrefix" name="assetTagPrefix" defaultValue={values.assetTagPrefix} /></Field>
          <Field label="Label footer text" name="labelSubtitle" className="sm:col-span-2"><Input id="labelSubtitle" name="labelSubtitle" defaultValue={values.labelSubtitle} /></Field>
        </div>
      </Card>
      <Card title="Modules">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="medicalModule" defaultChecked={values.medicalModule} className="mt-0.5 h-4 w-4" />
          <span>
            <strong>Medical devices</strong>
            <span className="block text-muted">UDI, risk class, biomed owner and preventive-maintenance scheduling on asset types marked as medical. Turn off for non-healthcare organisations; existing data is kept.</span>
          </span>
        </label>
      </Card>
      <Submit>Save settings</Submit>
    </ActionForm>
  );
}
