"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { Button, Card, Table, LinkButton } from "@/components/ui";
import type { ImportResult, ImportRow } from "@/server/modules/asset-import";
import { runImport } from "./actions";

export function Importer() {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFile = (f: File | undefined) => {
    setResult(null);
    setFatal(null);
    if (!f) return;
    setFileName(f.name);
    Papa.parse<ImportRow>(f, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.replace(/^﻿/, "").trim(),
      complete: (r) => {
        if (r.errors.length) setFatal(`CSV parse error on row ${(r.errors[0].row ?? 0) + 2}: ${r.errors[0].message}`);
        setRows(r.data);
      },
    });
  };

  const go = (dryRun: boolean) =>
    start(async () => {
      if (!rows) return;
      const r = await runImport(rows, dryRun);
      if ("fatal" in r) setFatal(r.fatal);
      else setResult(r);
    });

  const cols = rows?.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      <Card title="1. Choose file">
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
        {rows && (
          <p className="mt-2 text-sm text-muted">
            {fileName}: {rows.length} row{rows.length === 1 ? "" : "s"}, columns: {cols.join(", ")}
          </p>
        )}
      </Card>

      {fatal && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{fatal}</p>}

      {rows && rows.length > 0 && (
        <Card title="2. Preview (first 5 rows)">
          <Table>
            <thead>
              <tr>{cols.slice(0, 8).map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((r, i) => (
                <tr key={i}>{cols.slice(0, 8).map((c) => <td key={c} className="max-w-48 truncate">{r[c]}</td>)}</tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending} onClick={() => go(true)}>{pending ? "Working…" : "Validate (dry run)"}</Button>
            <Button
              disabled={pending || !result?.dryRun || result.errors.length > 0}
              onClick={() => {
                if (confirm(`Import ${rows.length} rows? Movements and audit entries will be recorded.`)) go(false);
              }}
            >
              Import
            </Button>
          </div>
          {!result && <p className="mt-2 text-xs text-muted">Run a dry run first — import is enabled once it passes with no errors.</p>}
        </Card>
      )}

      {result && (
        <Card title={result.dryRun ? "Dry-run result" : "Import complete"}>
          <p className="text-sm">
            {result.dryRun ? "Would create" : "Created"} <strong>{result.created}</strong>, {result.dryRun ? "would update" : "updated"}{" "}
            <strong>{result.updated}</strong>, errors <strong className={result.errors.length ? "text-danger" : ""}>{result.errors.length}</strong>.
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-80 space-y-1 overflow-auto text-sm">
              {result.errors.map((e) => (
                <li key={e.row} className="text-danger">
                  Row {e.row}{e.tag ? ` (${e.tag})` : ""}: {e.message}
                </li>
              ))}
            </ul>
          )}
          {!result.dryRun && <LinkButton className="mt-3" href="/assets?sort=updatedAt&dir=desc">View assets</LinkButton>}
        </Card>
      )}
    </div>
  );
}
