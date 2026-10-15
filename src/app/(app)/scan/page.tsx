import { PageHeader } from "@/components/ui";
import { Scanner } from "./scanner";

export const metadata = { title: "Scan" };

export default function ScanPage() {
  return (
    <>
      <PageHeader title="Scan asset tag" subtitle="Point the camera at a QR code or barcode, or type / use a USB scanner." />
      <Scanner />
    </>
  );
}
