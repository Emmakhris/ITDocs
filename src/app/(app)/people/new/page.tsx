import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/rbac/permissions";
import { listDepartments } from "@/server/modules/people";
import { PageHeader } from "@/components/ui";
import { PersonForm } from "../person-form";
import { savePersonAction } from "../actions";

export const metadata = { title: "Add person" };

export default async function NewPerson() {
  const ctx = await requireCtx();
  assertCan(ctx.user.role, "people", "write");
  const departments = (await listDepartments()).map((d) => ({ id: d.id, name: d.name }));
  return (
    <>
      <PageHeader title="Add person" crumbs={[{ href: "/people", label: "People" }]} />
      <PersonForm action={savePersonAction.bind(null, null)} departments={departments} cancelHref="/people" />
    </>
  );
}
