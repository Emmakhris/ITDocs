import { Planned } from "../_planned/planned";

export const metadata = { title: "Software & licenses" };

export default function Page() {
  return <Planned title="Software & licenses" phase={6} features={["Software catalogue and license records (keys encrypted)", "Seat allocation to assets/people with over-allocation warnings", "Expiry and renewal alerts"]} />;
}
