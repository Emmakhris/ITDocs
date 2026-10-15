import { Planned } from "../_planned/planned";

export const metadata = { title: "Vendors & contracts" };

export default function Page() {
  return <Planned title="Vendors & contracts" phase={6} features={["Vendor directory and support contacts", "Support, warranty, lease and SLA contracts", "Renewal / notice-period reminders, documents"]} />;
}
