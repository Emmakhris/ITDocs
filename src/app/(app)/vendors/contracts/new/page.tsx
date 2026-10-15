import { requireCtx } from "@/server/auth/session";
import { assertCan, can } from "@/server/rbac/permissions";
import { vendorOptions } from "@/server/modules/vendors";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { saveContractAction } from "../../actions";
import { ContractForm } from "../../forms";

export const metadata = { title: "New contract" };

export default async function NewContract({ searchParams }: { searchParams: Promise<{ vendorId?: string }> }) {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "vendors", "write");
  const { vendorId } = await searchParams;
  const vendors = await vendorOptions();
  return (
    <>
      <PageHeader crumbs={[{ href: "/vendors?tab=contracts", label: "Contracts" }]} title="New contract" />
      {vendors.length === 0 ? (
        <Empty title="Add a vendor first"><LinkButton href="/vendors?edit=new" variant="primary" className="mt-3">New vendor</LinkButton></Empty>
      ) : (
        <Card>
          <ContractForm action={saveContractAction.bind(null, null)} values={{ vendorId }} vendors={vendors} cancelHref={vendorId ? `/vendors/${vendorId}` : "/vendors?tab=contracts"} vaultUser={can(ctx.user.role, "vault", "read")} />
        </Card>
      )}
    </>
  );
}
