"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { applyReportColumns, inspectReportTables, normalizeReportColumns, type ReportColumnSelection, type ReportColumnTable } from "@/lib/report-columns";

function appliedColumns(query: string): string {
  const values = new URLSearchParams(query).getAll("kolom");
  if (values.length > 1) throw new Error("Pilihan kolom berulang.");
  return normalizeReportColumns(values[0] ?? null);
}

/** Preserve submitted choices, never the unchecked/checked edits awaiting Apply. */
export function ReportColumnsFilterInput() {
  const path = usePathname(), query = useSearchParams().toString();
  if (!path.startsWith("/laporan/")) return null;
  let value = "";
  try { value = appliedColumns(query); } catch { return null; }
  return value ? <input type="hidden" name="kolom" value={value} data-report-columns-input /> : null;
}

export function ReportColumns({ children }: { children: ReactNode }) {
  const path = usePathname(), query = useSearchParams().toString();
  // A fresh server result must own fresh DOM even when a refresh retains its URL.
  const [content, setContent] = useState({ children, revision: 0 });
  if (children !== content.children) setContent({ children, revision: content.revision + 1 });
  return <ColumnBoundary key={`${path}:${query}:${content.revision}`} path={path} query={query}>{children}</ColumnBoundary>;
}

function ColumnBoundary({ children, path, query }: { children: ReactNode; path: string; query: string }) {
  const router = useRouter(), report = useRef<HTMLDivElement>(null);
  const [tables, setTables] = useState<ReportColumnTable[]>([]);
  const [draft, setDraft] = useState<ReportColumnSelection>({});
  const [unsupported, setUnsupported] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const active = path.startsWith("/laporan/");

  useEffect(() => {
    if (!active || !report.current) return;
    const inspected = inspectReportTables(report.current);
    let restore = () => {}, failure = "", selection: ReportColumnSelection = {};
    try {
      const canonical = appliedColumns(query);
      selection = canonical ? JSON.parse(canonical) : {};
      restore = applyReportColumns(inspected.tables, selection);
    } catch {
      selection = {};
      failure = "Pilihan kolom tidak dapat diterapkan. Semua kolom tetap ditampilkan; atur ulang pilihan kolom untuk melanjutkan.";
    }
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setTables(inspected.tables); setUnsupported(inspected.unsupported); setDraft(selection); setError(failure); setReady(true);
    });
    return () => { mounted = false; restore(); };
  }, [active, query]);

  function navigate(selection: ReportColumnSelection) {
    try {
      const canonical = normalizeReportColumns(JSON.stringify(selection));
      const params = new URLSearchParams(query);
      if (canonical) params.set("kolom", canonical);
      else params.delete("kolom");
      const search = params.toString();
      router.replace(search ? `${path}?${search}` : path, { scroll: false });
    } catch { setError("Pilihan kolom belum diterapkan. Kurangi pilihan lalu coba lagi."); }
  }

  return <>
    {active && error && <p className="no-print" role="alert">{error}</p>}
    {active && (tables.length > 0 || unsupported > 0 || error) && <details className="crm-sec no-print" style={{ marginBottom: 8, padding: "8px 12px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 11.5 }}>Pilih kolom laporan</summary>
      <p style={{ fontSize: 12 }}>Pilih kolom yang ditampilkan, lalu terapkan. Minimal satu kolom per tabel; total perhitungan tetap mengikuti laporan asal.</p>
      {unsupported > 0 && <p style={{ fontSize: 12 }}>{unsupported} tabel dengan struktur khusus tetap ditampilkan lengkap.</p>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{tables.map((table, tableIndex) => {
        const hidden = draft[table.key] ?? [];
        return <fieldset key={table.key} style={{ margin: "0 0 12px", minWidth: 0, flex: "1 1 240px", maxWidth: "100%", border: "1px solid #e2e8f0", borderRadius: 6 }}>
          <legend>Tabel {tableIndex + 1}</legend>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{table.labels.map((label, index) => {
            const checked = !hidden.includes(index);
            return <label key={index} style={{ display: "flex", gap: 8, alignItems: "baseline", overflowWrap: "anywhere" }}>
              <input type="checkbox" checked={checked} disabled={checked && hidden.length >= table.labels.length - 1} onChange={event => {
                const visible = event.target.checked;
                setDraft(previous => ({ ...previous, [table.key]: visible ? (previous[table.key] ?? []).filter(value => value !== index) : [...(previous[table.key] ?? []), index] }));
              }} />
              {label || `Kolom ${index + 1}`}
            </label>;
          })}</div>
        </fieldset>;
      })}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tables.length > 0 && <button type="button" className="btn-def" disabled={!ready} onClick={() => navigate(draft)}>Terapkan kolom</button>}
        <button type="button" className="btn-def" onClick={() => navigate({})}>Tampilkan semua kolom</button>
      </div>
    </details>}
    <div id="laporan-isi" ref={report}>{children}</div>
  </>;
}
