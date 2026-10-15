import { Badge, fmtDate } from "./ui";

const META: Record<string, { label: string; tone: "gray" | "blue" | "green" | "amber" | "red" }> = {
  open: { label: "No end date", tone: "gray" },
  active: { label: "Active", tone: "green" },
  "notice-soon": { label: "Notice due soon", tone: "amber" },
  "notice-passed": { label: "Notice period passed", tone: "red" },
  expiring: { label: "Ending soon", tone: "amber" },
  expired: { label: "Expired", tone: "red" },
};

/** Contract / licence state badge (see src/server/lib/renewals.ts). */
export function RenewalBadge({ state, date }: { state: string; date?: Date | null }) {
  const m = META[state] ?? META.active;
  return (
    <Badge tone={m.tone}>
      {m.label}
      {date && state !== "active" && state !== "open" ? ` · ${fmtDate(date)}` : ""}
    </Badge>
  );
}

export const money = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? null : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
