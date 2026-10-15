import Link from "next/link";
import type { ChangeRisk, ChangeStatus, ChangeType, IncidentSeverity, IncidentStatus } from "@prisma/client";
import { Badge, cx } from "@/components/ui";

type Tone = "gray" | "blue" | "green" | "amber" | "red";

export const CHANGE_STATUS: Record<ChangeStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: "Draft", tone: "gray" },
  SUBMITTED: { label: "Awaiting approval", tone: "blue" },
  APPROVED: { label: "Approved", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
  IN_PROGRESS: { label: "In progress", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
  ROLLED_BACK: { label: "Rolled back", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};
export const CHANGE_TYPE: Record<ChangeType, string> = { STANDARD: "Standard (pre-approved)", NORMAL: "Normal", EMERGENCY: "Emergency" };
export const RISK: Record<ChangeRisk, { label: string; tone: Tone }> = { LOW: { label: "Low risk", tone: "green" }, MEDIUM: { label: "Medium risk", tone: "amber" }, HIGH: { label: "High risk", tone: "red" } };

export const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: Tone }> = {
  OPEN: { label: "Open", tone: "red" },
  INVESTIGATING: { label: "Investigating", tone: "amber" },
  MITIGATED: { label: "Mitigated", tone: "blue" },
  RESOLVED: { label: "Resolved", tone: "green" },
  CLOSED: { label: "Closed", tone: "gray" },
};
export const SEVERITY: Record<IncidentSeverity, { label: string; hint: string; tone: Tone }> = {
  P1: { label: "P1", hint: "Critical — patient care or a whole site affected", tone: "red" },
  P2: { label: "P2", hint: "Major — a department or key system down", tone: "red" },
  P3: { label: "P3", hint: "Moderate — degraded service, workaround exists", tone: "amber" },
  P4: { label: "P4", hint: "Minor — single user or cosmetic", tone: "gray" },
};

export const StatusBadge = ({ s }: { s: ChangeStatus }) => <Badge tone={CHANGE_STATUS[s].tone}>{CHANGE_STATUS[s].label}</Badge>;
export const IncidentBadge = ({ s }: { s: IncidentStatus }) => <Badge tone={INCIDENT_STATUS[s].tone}>{INCIDENT_STATUS[s].label}</Badge>;
export const SeverityBadge = ({ s }: { s: IncidentSeverity }) => <Badge tone={SEVERITY[s].tone}>{s}</Badge>;

/** "YYYY-MM-DDTHH:mm" in server-local time for datetime-local inputs. */
export function toDateTimeInput(d: Date | null | undefined) {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const TABS = [
  { href: "/changes", label: "Changes" },
  { href: "/changes/incidents", label: "Incidents" },
  { href: "/changes/journal", label: "Daily journal" },
];

export function SectionTabs({ active }: { active: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Changes and incidents sections">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined} className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.href === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
