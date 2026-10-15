import { Planned } from "../_planned/planned";

export const metadata = { title: "Reports" };

export default function Page() {
  return <Planned title="Reports" phase={8} features={["Built-in reports: inventory, warranty, PHI devices, movements by period", "Export to CSV, Excel and PDF", "Scheduled email reports"]} />;
}
