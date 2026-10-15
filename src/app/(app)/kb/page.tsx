import { Planned } from "../_planned/planned";

export const metadata = { title: "Knowledge base" };

export default function Page() {
  return <Planned title="Knowledge base" phase={5} features={["Rich-text SOPs, runbooks and how-tos", "Full version history with diff and restore", "Templates (SOP, runbook, onboarding)", "Attachments, tags, review-due reminders"]} />;
}
