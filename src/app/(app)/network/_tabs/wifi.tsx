import Link from "next/link";
import { Lock } from "lucide-react";
import { can } from "@/server/rbac/permissions";
import { listWifi, vlanOptions } from "@/server/modules/network";
import { locationTree } from "@/server/modules/locations";
import { ActionForm, ConfirmSubmit, Field, Submit } from "@/components/form";
import { LocationSelect, RemotePicker } from "@/components/pickers";
import { Badge, Card, Empty, Input, LinkButton, Select, Table, Textarea } from "@/components/ui";
import { deleteWifiAction, saveWifiAction } from "../actions";
import { WIFI_AUTH } from "../labels";
import { VlanSelect, type TabProps } from "./shared";

export async function WifiTab({ ctx, sp, writable }: TabProps) {
  const [rows, vlans, locations] = await Promise.all([listWifi(ctx), vlanOptions(), sp.edit ? locationTree() : []]);
  const editing = sp.edit && writable ? (sp.edit === "new" ? null : rows.find((r) => r.id === sp.edit)) : undefined;
  const vaultUser = can(ctx.user.role, "vault", "read");

  return (
    <div className="space-y-4">
      {writable && !sp.edit && (
        <div className="text-right"><LinkButton href="/network?tab=wifi&edit=new" variant="primary">New Wi-Fi network</LinkButton></div>
      )}

      {editing !== undefined && (
        <Card title={editing ? `Edit ${editing.ssid}` : "New Wi-Fi network"}>
          <ActionForm key={editing?.id ?? "new"} action={saveWifiAction.bind(null, editing?.id ?? null)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="SSID" name="ssid" required><Input id="ssid" name="ssid" defaultValue={editing?.ssid} /></Field>
              <Field label="Security" name="auth">
                <Select id="auth" name="auth" defaultValue={editing?.auth ?? "WPA2_ENTERPRISE"}>
                  {Object.entries(WIFI_AUTH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="VLAN" name="vlanId"><VlanSelect name="vlanId" options={vlans} defaultValue={editing?.vlanId} /></Field>
              <Field label="Site" name="locationId"><LocationSelect id="locationId" name="locationId" locations={locations} defaultValue={editing?.locationId} emptyLabel="— All sites —" /></Field>
              {vaultUser ? (
                <Field label="Key / RADIUS secret (vault)" name="credentialId" hint="The secret stays in the vault; only the link is stored here" className="lg:col-span-2">
                  <RemotePicker name="credentialId" kind="credentials" initial={editing?.credential ? { id: editing.credential.id, label: editing.credential.title } : null} placeholder="Search vault credentials…" />
                </Field>
              ) : (
                <p className="self-end text-xs text-muted lg:col-span-2">Linking a vault credential needs vault access.</p>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="hidden" defaultChecked={editing?.hidden} className="h-4 w-4 accent-brand" /> Hidden SSID (not broadcast)
              </label>
              <Field label="Notes" name="notes" className="sm:col-span-2 lg:col-span-3"><Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} className="min-h-16" placeholder="Controller, RADIUS server, captive portal…" /></Field>
            </div>
            <div className="flex gap-2"><Submit>Save Wi-Fi network</Submit><LinkButton href="/network?tab=wifi">Cancel</LinkButton></div>
          </ActionForm>
          {editing && (
            <ActionForm action={deleteWifiAction.bind(null, editing.id)} className="mt-4 border-t border-line pt-4 text-right">
              <ConfirmSubmit message={`Delete Wi-Fi network ${editing.ssid}? The vault credential is not deleted.`}>Delete</ConfirmSubmit>
            </ActionForm>
          )}
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty title="No Wi-Fi networks yet">Record SSIDs, their security, VLAN, and which vault entry holds the key.</Empty>
      ) : (
        <Table>
          <thead>
            <tr><th>SSID</th><th>Security</th><th>VLAN</th><th>Site</th><th>Key</th><th>Notes</th>{writable && <th />}</tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id}>
                <td className="font-medium">{w.ssid} {w.hidden && <Badge>hidden</Badge>}</td>
                <td><Badge tone={w.auth === "OPEN" ? "amber" : "gray"}>{WIFI_AUTH[w.auth]}</Badge></td>
                <td>{w.vlan ? `${w.vlan.number} · ${w.vlan.name}` : <span className="text-muted">—</span>}</td>
                <td>{w.location?.name ?? <span className="text-muted">All sites</span>}</td>
                <td>
                  {w.credential ? (
                    <Link href={`/vault/${w.credential.id}`} className="inline-flex items-center gap-1 text-brand hover:underline"><Lock className="h-3.5 w-3.5" />{w.credential.title}</Link>
                  ) : w.hasCredential ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted"><Lock className="h-3.5 w-3.5" />In vault (no access)</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="max-w-xs text-muted">{w.notes}</td>
                {writable && <td className="text-right"><Link href={`/network?tab=wifi&edit=${w.id}`} className="text-xs text-brand hover:underline">Edit</Link></td>}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
