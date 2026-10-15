import { Planned } from "../_planned/planned";

export const metadata = { title: "Password vault" };

export default function Page() {
  return <Planned title="Password vault" phase={3} features={["AES-256-GCM encrypted credentials with master key outside the database", "Folders with per-folder access", "Every reveal / copy written to the audit log", "Password history, rotation reminders, optional TOTP seeds", "Link credentials to assets, network devices and vendors"]} />;
}
