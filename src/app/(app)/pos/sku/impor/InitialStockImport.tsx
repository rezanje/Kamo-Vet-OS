"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  previewSaldoAwalAccurate,
  type InitialStockState,
} from "./actions";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const qty = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });

export function InitialStockImport({
  sourceFile,
  masterRunId,
  presetState,
  onPresetStateChange,
}: {
  sourceFile: File | null;
  masterRunId: string | null;
  presetState?: InitialStockState | null;
  onPresetStateChange?: (state: InitialStockState) => void;
}) {
  const [state, setState] = useState<InitialStockState | null>(null);
  const [localError, setLocalError] = useState("");
  const [rowFilter, setRowFilter] = useState<"auto" | "all" | "valid" | "skipped" | "rejected">("auto");
  const [pending, startTransition] = useTransition();
  const displayedState = presetState ?? state;
  const activeFilter = rowFilter === "auto" ? (displayedState?.ok ? "all" : "rejected") : rowFilter;
  const validCount = displayedState?.rows.filter((row) => row.status === "valid").length ?? 0;
  const skippedCount = displayedState?.rows.filter((row) => row.status === "skipped").length ?? 0;
  const rejectedRows = displayedState?.rows.filter((row) => row.status === "rejected") ?? [];
  const rejectedCount = rejectedRows.length;
  const visibleRows = displayedState?.rows.filter((row) => activeFilter === "all" || row.status === activeFilter) ?? [];
  const reasons = [...new Map(rejectedRows.map((row) => [row.reason ?? "Perlu klarifikasi", 0]))]
    .map(([reason]) => ({ reason, count: rejectedRows.filter((row) => row.reason === reason).length }));
  const showManualControls = !presetState;

  const run = () => {
    if (!sourceFile || !masterRunId) {
      setLocalError("Konfirmasi Barang & Jasa wajib selesai dulu.");
      return;
    }
    setLocalError("");
    startTransition(async () => {
      const data = new FormData();
      data.append("initial_stock_file", sourceFile);
      data.append("master_run_id", masterRunId);
      const result = await previewSaldoAwalAccurate(data);
      setRowFilter(result.ok ? "all" : "rejected");
      setState(result);
      onPresetStateChange?.(result);
    });
  };

  return (
    <section className="crm-sec" style={{ marginBottom: 16 }}>
      {showManualControls && <>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Saldo Stok Awal</div>
        <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3, lineHeight: 1.55 }}>
          Memakai file yang sama. Cabang, gudang, dan tanggal dibaca otomatis dari file.
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <span style={{ fontSize: 11, color: sourceFile && masterRunId ? "#166534" : "var(--tm)" }}>
            <i className="ti ti-file-spreadsheet" /> {sourceFile && masterRunId ? sourceFile.name : "Pilih dan cek file impor dulu"}
          </span>
          <button type="button" className="btn-acc" disabled={pending || !sourceFile || !masterRunId} onClick={run}>
            <i className={`ti ${pending ? "ti-loader-2" : "ti-eye"}`} /> {pending ? "Memproses…" : "Cek saldo"}
          </button>
        </div>
      </>}

      {localError && (
        <div className="p2ban" style={{ marginTop: 10, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {localError}
        </div>
      )}

      {displayedState && displayedState.rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
            <span className="badge g">Siap {validCount}</span>
            <span className="badge y">Dilewati {skippedCount}</span>
            <span className="badge r">Perlu klarifikasi {rejectedCount}</span>
            <span className="badge b">Qty dasar {qty.format(displayedState.source_qty)}</span>
            <span className="badge y">Nilai {rupiah.format(displayedState.source_value)}</span>
          </div>
          {rejectedCount > 0 ? (
            <div className="p2ban" style={{ marginTop: 10, background: "#fffbeb", border: ".5px solid #fcd34d", color: "#854d0e" }}>
              <b>{rejectedCount} baris tidak masuk — {validCount} saldo aman tetap bisa diposting.</b>
              {reasons.map(({ reason, count }) => <div key={reason} style={{ marginTop: 4 }}>• {count} baris: {reason}.</div>)}
              <div style={{ marginTop: 5 }}>Baris ini tetap tampil untuk diperbaiki dan diimpor susulan.</div>
            </div>
          ) : (
            <div className="p2ban" style={{ marginTop: 10, background: "#f0fdf4", border: ".5px solid #bbf7d0", color: "#166534" }}>
              Semua saldo yang akan masuk sudah siap. {skippedCount} baris jasa atau saldo nol dilewati dan tidak menghalangi posting.
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {([
              ["all", "Semua"], ["valid", `Siap (${validCount})`], ["skipped", `Dilewati (${skippedCount})`], ["rejected", `Perlu klarifikasi (${rejectedCount})`],
            ] as const).map(([filter, label]) => (
              <button key={filter} type="button" className="btn-def" onClick={() => setRowFilter(filter)}
                style={{ background: activeFilter === filter ? "#e0e7ff" : undefined, borderColor: activeFilter === filter ? "#818cf8" : undefined }}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto", marginTop: 10, maxHeight: 220 }}>
            <table className="data-table" style={{ fontSize: 10.5 }}>
              <thead><tr><th>Baris</th><th>Barang</th><th>Satuan</th><th>Qty dasar</th><th>Status</th><th>Catatan</th></tr></thead>
              <tbody>{visibleRows.map((row) => (
                <tr key={`${row.row}-${row.itemCode}`}>
                  <td>{row.sourceRows?.join(", ") ?? row.row}</td><td>{row.itemCode}{row.itemName ? ` — ${row.itemName}` : ""}</td><td>{row.unit}</td>
                  <td>{qty.format(row.baseQty)}</td>
                  <td><span className={`badge ${row.status === "valid" ? "g" : row.status === "skipped" ? "y" : "r"}`}>{row.status === "valid" ? "Siap" : row.status === "skipped" ? "Dilewati" : "Klarifikasi"}</span></td>
                  <td style={{ color: row.status === "rejected" ? "#b91c1c" : "var(--tm)" }}>{row.reason ?? "Siap"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {displayedState?.phase === "preview" && displayedState.run_id && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 11 }}>Batch ini belum masuk stok atau buku besar. OWNER perlu meninjau jumlah, cabang, tanggal, dan akun lawan sebelum posting.</p>
          <Link className="btn-acc" href={`/keuangan/persediaan-awal?run_id=${encodeURIComponent(displayedState.run_id)}`}>
            Tinjau dan posting stok + jurnal
          </Link>
        </div>
      )}

      {displayedState?.phase === "done" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: displayedState.ok ? "#166534" : "#b91c1c", fontWeight: 700 }}>{displayedState.message}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 7, marginTop: 9 }}>
            {displayedState.checks.map((check) => (
              <div key={check.label} style={{ padding: "8px 10px", borderRadius: 8, background: check.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${check.ok ? "#bbf7d0" : "#fecaca"}`, fontSize: 10.5 }}>
                <i className={`ti ${check.ok ? "ti-circle-check" : "ti-alert-circle"}`} /> {check.label}: {check.ok ? "cocok" : qty.format(check.difference)}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
