import { PageHeader, Card } from "@/components/ui";

export function Planned({ title, phase, features }: { title: string; phase: number; features: string[] }) {
  return (
    <>
      <PageHeader title={title} subtitle={`Planned for phase ${phase} of the build`} />
      <Card title="What this module will include">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
