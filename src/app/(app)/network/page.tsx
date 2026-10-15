import { Planned } from "../_planned/planned";

export const metadata = { title: "Network" };

export default function Page() {
  return <Planned title="Network" phase={4} features={["IPAM: subnets, IP allocations linked to assets", "VLANs and Wi-Fi networks", "Racks with visual U-position layout", "Switch-port / patch-panel / wall-jack mapping"]} />;
}
