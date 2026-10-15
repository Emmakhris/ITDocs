import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { changeOptions } from "@/server/modules/changes";
import { ownerOptions } from "@/server/modules/incidents";
import { PageHeader } from "@/components/ui";
import { saveIncidentAction } from "../../actions";
import { IncidentForm } from "../incident-form";

export const metadata = { title: "Report incident" };

export default async function NewIncident() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "changes", "write");
  const [owners, changes] = await Promise.all([ownerOptions(), changeOptions()]);
  return (
    <>
      <PageHeader crumbs={[{ href: "/changes/incidents", label: "Incidents" }]} title="Report incident" subtitle="Open it now; add details, root cause and resolution as you learn more." />
      <IncidentForm action={saveIncidentAction.bind(null, null)} owners={owners} changes={changes} cancelHref="/changes/incidents" editing={false} />
    </>
  );
}
