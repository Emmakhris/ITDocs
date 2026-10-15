import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">That record doesn&apos;t exist or was deleted.</p>
      <div className="mt-5"><LinkButton href="/dashboard">Dashboard</LinkButton></div>
    </div>
  );
}
