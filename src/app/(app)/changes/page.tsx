import { Planned } from "../_planned/planned";

export const metadata = { title: "Changes & incidents" };

export default function Page() {
  return <Planned title="Changes & incidents" phase={7} features={["Change records: risk, window, approver, rollback plan", "Incident records with timelines and root cause", "Daily tech journal / on-call log", "Linked to affected assets"]} />;
}
