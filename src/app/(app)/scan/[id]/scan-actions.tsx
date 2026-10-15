"use client";

import { useEffect, useState } from "react";
import { ActionForm, Field, Submit } from "@/components/form";
import { Card, Input } from "@/components/ui";
import { LocationSelect, type LocationOpt } from "@/components/pickers";
import { checkinAction, moveAction } from "../../assets/actions";

const LAST_LOC = "itdocs.scan.lastLocation";

export function ScanActions({
  assetId,
  currentLocationId,
  checkedOut,
  locations,
}: {
  assetId: string;
  currentLocationId: string | null;
  checkedOut: boolean;
  locations: LocationOpt[];
}) {
  // Remember the last location used so a tech walking a room can scan many devices quickly
  const [loc, setLoc] = useState<string>("");
  useEffect(() => {
    try {
      setLoc(localStorage.getItem(LAST_LOC) ?? currentLocationId ?? "");
    } catch {
      setLoc(currentLocationId ?? "");
    }
  }, [currentLocationId]);

  return (
    <>
      <Card title="Record where it is now">
        <ActionForm action={moveAction.bind(null, [assetId], "SCAN")} className="space-y-3">
          <Field label="Location" name="toLocationId">
            <div
              onChange={(e) => {
                const v = (e.target as unknown as HTMLSelectElement).value;
                try {
                  localStorage.setItem(LAST_LOC, v);
                } catch {}
              }}
            >
              <LocationSelect key={loc} id="toLocationId" name="toLocationId" locations={locations} defaultValue={loc} emptyLabel="Choose…" />
            </div>
          </Field>
          <Field label="Reason" name="reason">
            <Input id="reason" name="reason" defaultValue="Located during scan / inventory audit" />
          </Field>
          <Submit className="h-11 w-full">Confirm location</Submit>
        </ActionForm>
      </Card>
      {checkedOut && (
        <Card title="Return loan">
          <ActionForm action={checkinAction.bind(null, assetId, "SCAN")} className="space-y-3">
            <Field label="Return to" name="toLocationId">
              <LocationSelect id="toLocationId-in" name="toLocationId" locations={locations} emptyLabel="— Keep current —" />
            </Field>
            <input type="hidden" name="toStatus" value="IN_STOCK" />
            <Submit className="h-11 w-full">Check in</Submit>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
