"use client";

import { useState } from "react";
import { ActionForm, Field, Submit } from "@/components/form";
import { Input, Select, Textarea, STATUS_META, cx } from "@/components/ui";
import { LocationSelect, RemotePicker, type LocationOpt } from "@/components/pickers";
import { checkinAction, checkoutAction, disposeAction, moveAction } from "../actions";

type Tab = "move" | "checkout" | "checkin" | "dispose";

export function AssetActionPanels({
  assetId,
  locations,
  checkedOut,
  disposed,
  storesPhi,
  initialTab,
}: {
  assetId: string;
  locations: LocationOpt[];
  checkedOut: boolean;
  disposed: boolean;
  storesPhi: boolean;
  initialTab?: Tab;
}) {
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "move", label: "Move / reassign", show: !disposed },
    { id: "checkout", label: "Check out", show: !disposed && !checkedOut },
    { id: "checkin", label: "Check in", show: checkedOut },
    { id: "dispose", label: "Dispose", show: !disposed && !checkedOut },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab | null>(initialTab && visible.some((t) => t.id === initialTab) ? initialTab : null);
  if (!visible.length) return null;

  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap gap-1 border-b border-line p-2">
        {visible.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(tab === t.id ? null : t.id)}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              tab === t.id ? "bg-brand text-brand-fg" : "hover:bg-surface-2",
              t.id === "dispose" && tab !== t.id && "text-danger",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab && (
        <div className="p-4">
          {tab === "move" && (
            <ActionForm action={moveAction.bind(null, [assetId], "MANUAL")} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
              <Field label="New location" name="toLocationId">
                <LocationSelect id="toLocationId" name="toLocationId" locations={locations} emptyLabel="— Keep current —" />
              </Field>
              <Field label="New assignee" name="toAssigneeId">
                <RemotePicker id="toAssigneeId" name="toAssigneeId" kind="people" placeholder="Keep current / search…" />
              </Field>
              <Field label="New status" name="toStatus">
                <Select id="toStatus" name="toStatus" defaultValue="">
                  <option value="">— Keep current —</option>
                  {Object.entries(STATUS_META)
                    .filter(([k]) => k !== "DISPOSED")
                    .map(([k, m]) => (
                      <option key={k} value={k}>{m.label}</option>
                    ))}
                </Select>
              </Field>
              <Field label="Ticket / work order #" name="ticketRef">
                <Input id="ticketRef" name="ticketRef" />
              </Field>
              <Field label="Reason" name="reason" required className="sm:col-span-2">
                <Input id="reason" name="reason" placeholder="e.g. Relocated to ICU bed 4 for new admission" />
              </Field>
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="clearAssignee" className="h-4 w-4" /> Unassign from current person
                </label>
                <Field label="When (if not now)" name="movedAt" className="w-48">
                  <Input id="movedAt" type="datetime-local" name="movedAt" />
                </Field>
              </div>
              <div className="sm:col-span-2"><Submit>Record movement</Submit></div>
            </ActionForm>
          )}
          {tab === "checkout" && (
            <ActionForm action={checkoutAction.bind(null, assetId)} className="grid gap-4 sm:grid-cols-2">
              <Field label="Borrower" name="personId" required>
                <RemotePicker id="personId" name="personId" kind="people" placeholder="Search people…" />
              </Field>
              <Field label="Due back" name="dueAt">
                <Input id="dueAt" type="date" name="dueAt" />
              </Field>
              <Field label="Deliver to location (optional)" name="toLocationId">
                <LocationSelect id="toLocationId" name="toLocationId" locations={locations} emptyLabel="— Keep current —" />
              </Field>
              <Field label="Condition going out" name="outCondition">
                <Input id="outCondition" name="outCondition" placeholder="e.g. Good, charger included" />
              </Field>
              <Field label="Notes" name="notes" className="sm:col-span-2"><Textarea id="notes" name="notes" rows={2} /></Field>
              <div className="sm:col-span-2"><Submit>Check out</Submit></div>
            </ActionForm>
          )}
          {tab === "checkin" && (
            <ActionForm action={checkinAction.bind(null, assetId, "CHECKIN")} className="grid gap-4 sm:grid-cols-2">
              <Field label="Return to location" name="toLocationId">
                <LocationSelect id="toLocationId" name="toLocationId" locations={locations} emptyLabel="— Keep current —" />
              </Field>
              <Field label="Status after return" name="toStatus">
                <Select id="toStatus" name="toStatus" defaultValue="IN_STOCK">
                  <option value="IN_STOCK">In stock</option>
                  <option value="DEPLOYED">Deployed</option>
                  <option value="IN_REPAIR">In repair</option>
                </Select>
              </Field>
              <Field label="Condition on return" name="inCondition" className="sm:col-span-2"><Input id="inCondition" name="inCondition" /></Field>
              <div className="sm:col-span-2"><Submit>Check in</Submit></div>
            </ActionForm>
          )}
          {tab === "dispose" && (
            <ActionForm action={disposeAction.bind(null, assetId)} className="grid gap-4 sm:grid-cols-2">
              <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn sm:col-span-2">
                Disposal is final: the asset becomes read-only and leaves all locations.
                {storesPhi && " This device is flagged as storing PHI — a data-wipe method is required."}
              </p>
              <Field label="Disposal date" name="disposedAt" required><Input id="disposedAt" type="date" name="disposedAt" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
              <Field label="Method" name="method" required>
                <Select id="method" name="method" defaultValue="">
                  <option value="">Choose…</option>
                  <option>E-waste recycling</option>
                  <option>Physical destruction</option>
                  <option>Return to vendor / lessor</option>
                  <option>Resale</option>
                  <option>Donation</option>
                </Select>
              </Field>
              <Field label="Data-wipe method" name="wipeMethod" required={storesPhi}>
                <Select id="wipeMethod" name="wipeMethod" defaultValue="">
                  <option value="">None / not applicable</option>
                  <option>NIST 800-88 Clear</option>
                  <option>NIST 800-88 Purge (secure erase / crypto erase)</option>
                  <option>NIST 800-88 Destroy (shred / degauss)</option>
                  <option>Vendor certified wipe</option>
                </Select>
              </Field>
              <Field label="Certificate # / reference" name="certificateRef"><Input id="certificateRef" name="certificateRef" /></Field>
              <Field label="Disposal vendor" name="vendor"><Input id="vendor" name="vendor" /></Field>
              <Field label="Witness" name="witness"><Input id="witness" name="witness" /></Field>
              <Field label="Notes" name="notes" className="sm:col-span-2"><Textarea id="notes" name="notes" rows={2} /></Field>
              <div className="sm:col-span-2"><Submit variant="danger">Record disposal</Submit></div>
            </ActionForm>
          )}
        </div>
      )}
    </section>
  );
}
