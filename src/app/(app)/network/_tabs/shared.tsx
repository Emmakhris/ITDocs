import type { Ctx } from "@/server/context";
import { Select, cx } from "@/components/ui";
import type { NetworkSearch } from "../page";

export type TabProps = { ctx: Ctx; sp: NetworkSearch; writable: boolean };

/** Horizontal usage meter: share of usable addresses / rack units in use. */
export function UsageBar({ used, total, className }: { used: number; total: number; className?: string }) {
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className={cx("flex items-center gap-2", className)}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Usage">
        <div className={cx("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs text-muted">
        {used}/{total} · {pct}%
      </span>
    </div>
  );
}

export function VlanSelect({ name, options, defaultValue, id }: { name: string; id?: string; options: { id: string; label: string }[]; defaultValue?: string | null }) {
  return (
    <Select id={id ?? name} name={name} defaultValue={defaultValue ?? ""}>
      <option value="">— None —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </Select>
  );
}
