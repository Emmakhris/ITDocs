import { Planned } from "../_planned/planned";

export const metadata = { title: "Diagrams" };

export default function Page() {
  return <Planned title="Diagrams" phase={8} features={["Upload network / floor diagrams (image, PDF, draw.io export)", "Link diagrams to locations and assets", "Relationship map across all records"]} />;
}
