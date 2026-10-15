import Link from "next/link";
import type { ContractType } from "@prisma/client";
import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { listContracts, listVendors, renewals } from "@/server/modules/vendors";
import { RenewalBadge, money } from "@/components/renewal-badge";
import { Badge, Button, Card, Empty, Input, LinkButton, PageHeader, Select, Table, cx, fmtDate } from "@/components/ui";
import { saveVendorAction } from "./actions";
import { VendorForm } from "./forms";
import { CONTRACT_TYPE } from "./labels";

export const metadata = { title: "Vendors & contracts" };

const TABS = [
  { key: "vendors", label: "Vendors" },
  { key: "contracts", label: "Contracts" },
  { key: "renewals", label: "Renewals" },
] as const;

type Search = { tab?: string; q?: string; edit?: string; type?: string; state?: string; days?: string };

export default async function VendorsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "vendors", "read");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "vendors";
  const writable = can(ctx.user.role, "vendors", "write");

  return (
    <>
      <PageHeader
        title="Vendors & contracts"
        subtitle="Suppliers, support contacts, contracts and what's coming up for renewal."
        actions={
          writable && (
            <>
              <LinkButton href="/vendors/contracts/new">New contract</LinkButton>
              <LinkButton href="/vendors?edit=new" variant="primary">New vendor</LinkButton>
            </>
          )
        }
      />
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Vendor sections">
        {TABS.map((t) => (
          <Link key={t.key} href={`/vendors?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === tab ? "border-brand text-brand" : "border-transparent text-muted hover:text-fg")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "vendors" && <VendorsTab sp={sp} writable={writable} ctx={ctx} />}
      {tab === "contracts" && <ContractsTab sp={sp} ctx={ctx} />}
      {tab === "renewals" && <RenewalsTab sp={sp} ctx={ctx} />}
    </>
  );
}

type TabProps = { sp: Search; ctx: Awaited<ReturnType<typeof requireCtx>> };

async function VendorsTab({ sp, writable, ctx }: TabProps & { writable: boolean }) {
  const rows = await listVendors(ctx, { q: sp.q });
  return (
    <div className="space-y-4">
      {writable && sp.edit === "new" && (
        <Card title="New vendor"><VendorForm action={saveVendorAction.bind(null, null)} cancelHref="/vendors" /></Card>
      )}
      <form className="grid gap-2 sm:grid-cols-[minmax(0,22rem)_auto]">
        <Input name="q" defaultValue={sp.q} placeholder="Vendor, account number or contact…" aria-label="Search vendors" />
        <Button variant="secondary">Search</Button>
      </form>
      {rows.length === 0 ? (
        <Empty title={sp.q ? "No matching vendors" : "No vendors yet"}>Add the companies you buy from and get support from.</Empty>
      ) : (
        <Table>
          <thead><tr><th>Vendor</th><th>Support</th><th>Account</th><th>Contracts</th><th>Software</th><th>Contacts</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td><Link href={`/vendors/${v.id}`} className="font-medium text-brand hover:underline">{v.name}</Link></td>
                <td className="text-xs">{[v.supportPhone, v.supportEmail].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}</td>
                <td className="font-mono text-xs">{v.accountNumber}</td>
                <td>{v._count.contracts}</td>
                <td>{v._count.software}</td>
                <td>{v._count.contacts}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

async function ContractsTab({ sp, ctx }: TabProps) {
  const type = sp.type && sp.type in CONTRACT_TYPE ? (sp.type as ContractType) : undefined;
  const state = sp.state === "soon" || sp.state === "expired" || sp.state === "active" ? sp.state : undefined;
  const rows = await listContracts(ctx, { q: sp.q, type, state });
  const total = rows.filter((c) => c.state !== "expired").reduce((n, c) => n + Number(c.annualCost ?? 0), 0);
  return (
    <div className="space-y-4">
      <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,20rem)_12rem_12rem_auto]">
        <input type="hidden" name="tab" value="contracts" />
        <Input name="q" defaultValue={sp.q} placeholder="Title, number or vendor…" aria-label="Search contracts" />
        <Select name="type" defaultValue={sp.type ?? ""} aria-label="Contract type">
          <option value="">All types</option>
          {Object.entries(CONTRACT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="state" defaultValue={sp.state ?? ""} aria-label="Contract state">
          <option value="">Any state</option>
          <option value="active">Current</option>
          <option value="soon">Needs action soon</option>
          <option value="expired">Expired</option>
        </Select>
        <Button variant="secondary" className="justify-self-start">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <Empty title="No contracts found">Record support, maintenance, lease and subscription agreements to get notice-period reminders.</Empty>
      ) : (
        <>
          <Table>
            <thead><tr><th>Contract</th><th>Vendor</th><th>Type</th><th>Ends</th><th>Notice by</th><th>Status</th><th className="text-right">Annual cost</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/vendors/contracts/${c.id}`} className="font-medium text-brand hover:underline">{c.title}</Link>
                    {c.reference && <span className="block font-mono text-xs text-muted">{c.reference}</span>}
                  </td>
                  <td><Link href={`/vendors/${c.vendor.id}`} className="hover:underline">{c.vendor.name}</Link></td>
                  <td>{CONTRACT_TYPE[c.type]}</td>
                  <td className="whitespace-nowrap">{fmtDate(c.endDate) || "—"}{c.autoRenew && <Badge className="ml-1">auto-renews</Badge>}</td>
                  <td className="whitespace-nowrap">{fmtDate(c.noticeBy) || "—"}</td>
                  <td><RenewalBadge state={c.state} /></td>
                  <td className="text-right tabular-nums">{money(c.annualCost)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-right text-xs text-muted">Annual cost of current contracts shown: <strong className="text-fg">{money(total)}</strong></p>
        </>
      )}
    </div>
  );
}

async function RenewalsTab({ sp, ctx }: TabProps) {
  const days = [30, 60, 90, 180].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const items = await renewals(ctx, days);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Due within</span>
        {[30, 60, 90, 180].map((d) => (
          <Link key={d} href={`/vendors?tab=renewals&days=${d}`} className={cx("rounded px-2 py-0.5", d === days ? "bg-brand text-brand-fg" : "bg-surface-2 hover:text-fg")}>{d} days</Link>
        ))}
        <span className="text-xs text-muted">(plus anything that lapsed in the last 30 days)</span>
      </div>
      {items.length === 0 ? (
        <Empty title="Nothing due">No contract notice deadlines, contract ends or licence expiries in this window.</Empty>
      ) : (
        <Table>
          <thead><tr><th>Due</th><th>What</th><th>Item</th><th>Vendor</th><th>Status</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.kind + r.id}>
                <td className="whitespace-nowrap">
                  {fmtDate(r.due)}
                  <span className={cx("block text-xs", r.daysLeft < 0 ? "text-danger" : r.daysLeft <= 14 ? "text-warn" : "text-muted")}>{r.daysLeft < 0 ? `${-r.daysLeft} days ago` : r.daysLeft === 0 ? "today" : `in ${r.daysLeft} days`}</span>
                </td>
                <td>{r.what}</td>
                <td>
                  <Link href={r.href} className="text-brand hover:underline">{r.title}</Link>
                  <span className="block text-xs text-muted">{r.kind === "license" ? "Software licence" : "Contract"}</span>
                </td>
                <td>{r.vendor ?? <span className="text-muted">—</span>}</td>
                <td><RenewalBadge state={r.state} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
