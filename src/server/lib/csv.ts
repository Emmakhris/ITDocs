/** RFC 4180 CSV cell, with formula-injection protection for spreadsheet apps. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";

/** Stream rows as a CSV download (UTF-8 BOM so Excel detects the encoding). */
export function csvResponse(filename: string, header: string[], rows: AsyncIterable<unknown[]> | Iterable<unknown[]>) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      ctl.enqueue(enc.encode("﻿" + csvRow(header)));
      for await (const r of rows as AsyncIterable<unknown[]>) ctl.enqueue(enc.encode(csvRow(r)));
      ctl.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
