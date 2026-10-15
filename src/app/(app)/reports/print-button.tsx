"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** Opens the browser print dialog — "Save as PDF" there gives a PDF of the report. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden /> Print / PDF
    </Button>
  );
}
