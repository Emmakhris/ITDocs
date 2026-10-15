import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { PageHeader, cx } from "@/components/ui";
import { TABS, type TabKey } from "./labels";
import { SubnetsTab } from "./_tabs/subnets";
import { VlansTab } from "./_tabs/vlans";
import { RacksTab } from "./_tabs/racks";
import { PortsTab } from "./_tabs/ports";
import { WifiTab } from "./_tabs/wifi";

export const metadata = { title: "Network" };

export type NetworkSearch = { tab?: string; edit?: string; q?: string; switchId?: string };

export default async function NetworkPage({ searchParams }: { searchParams: Promise<NetworkSearch> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "network", "read");
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "subnets";
  const writable = can(ctx.user.role, "network", "write");
  const props = { ctx, sp, writable };

  return (
    <>
      <PageHeader title="Network" subtitle="IP address management, VLANs, racks, switch-port mapping and Wi-Fi. IPv4 only." />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Network sections">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/network?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              t.key === tab ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "subnets" && <SubnetsTab {...props} />}
      {tab === "vlans" && <VlansTab {...props} />}
      {tab === "racks" && <RacksTab {...props} />}
      {tab === "ports" && <PortsTab {...props} />}
      {tab === "wifi" && <WifiTab {...props} />}
    </>
  );
}
