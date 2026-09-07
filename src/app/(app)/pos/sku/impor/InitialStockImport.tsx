"use client";

import { useState, useTransition } from "react";
import {
  postSaldoAwalAccurate,
  previewSaldoAwalAccurate,
  type InitialStockState,
} from "./actions";

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const qty = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });

export function InitialStockImport({
  sourceFile,
  masterRunId,
}: {
  sourceFile: File | null;
  masterRunId: string | null;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<InitialStockState | null>(null);
  const [localError, setLocalError] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (action: typeof previewSaldoAwalAccurate | typeof postSaldoAwalAccurate) => {
    if (!sourceFile || !masterRunId) {
      setLocalError("Konfirmasi Barang & Jasa wajib selesai dulu.");
      return;
    }
    setLocalError("");
    startTransition(async () => {
      const data = new FormData();
      data.append("initial_stock_file", sourceFile);
      data.append("master_run_id", masterRunId);
      if (confirmed) data.append("confirm_scope", "on");
      if (action === postSaldoAwalAccurate && state?.run_id) {
        data.append("run_id", state.run_id);
        data.append("branch_id", state.branch_id ?? "");
        data.append("warehouse_id", state.warehouse_id ?? "");
        data.append("as_of", state.as_of ?? "");
      }
      setState(await action(data));
    });
  };

  return (
    <section className="crm-sec" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Saldo Stok Awal</div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3, lineHeight: 1.55 }}>
        Masih dalam alur impor file yang sama. Cabang, gudang, dan tanggal dibaca otomatis dari file.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <span style={{ fontSize: 11, color: sourceFile && masterRunId ? "#166534" : "var(--tm)" }}>
          <i className="ti ti-file-spreadsheet" /> {sourceFile && masterRunId ? sourceFile.name : "Pilih dan cek file impor dulu"}
        </span>
        <button type="button" className="btn-acc" disabled={pending || !sourceFile || !masterRunId} onClick={() => run(previewSaldoAwalAccurate)}>
          <i className={`ti ${pending ? "ti-loader-2" : "ti-eye"}`} /> {pending ? "Memproses…" : "Cek saldo"}
        </button>
      </div>

      {(localError || (state && !state.ok && state.phase === "preview")) && (
        <div className="p2ban" style={{ marginTop: 10, background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {localError || state?.message}
        </div>
      )}

      {state && state.rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
            <span className="badge g">Valid {state.rows.filter((row) => row.status === "valid").length}</span>
            <span className="badge r">Ditolak {state.rows.filter((row) => row.status === "rejected").length}</span>
            <span className="badge b">Qty dasar {qty.format(state.source_qty)}</span>
            <span className="badge y">Nilai {rupiah.format(state.source_value)}</span>
          </div>
          <div style={{ overflowX: "auto", marginTop: 10, maxHeight: 220 }}>
            <table className="data-table" style={{ fontSize: 10.5 }}>
              <thead><tr><th>Baris</th><th>Barang</th><th>Satuan</th><th>Qty dasar</th><th>Status</th><th>Catatan</th></tr></thead>
              <tbody>{state.rows.map((row) => (
                <tr key={`${row.row}-${row.itemCode}`}>
                  <td>{row.row}</td><td>{row.itemCode}{row.itemName ? ` — ${row.itemName}` : ""}</td><td>{row.unit}</td>
                  <td>{qty.format(row.baseQty)}</td>
                  <td><span className={`badge ${row.status === "valid" ? "g" : "r"}`}>{row.status}</span></td>
                  <td style={{ color: row.reason ? "#b91c1c" : "var(--tm)" }}>{row.reason ?? "Siap"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      {state?.phase === "preview" && state.run_id && (
        <div style={{ marginTop: 12 }}>
          <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 11, color: "var(--sb)" }}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>Saya sudah mencocokkan tujuan dan tanggal saldo dari preview.</span>
          </label>
          <button type="button" className="btn-acc" style={{ marginTop: 9, background: "#15803d" }}
            disabled={pending || !state.ok || !confirmed} onClick={() => run(postSaldoAwalAccurate)}>
            <i className="ti ti-database-import" /> {pending ? "Posting…" : "Posting saldo awal"}
          </button>
        </div>
      )}

      {state?.phase === "done" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: state.ok ? "#166534" : "#b91c1c", fontWeight: 700 }}>{state.message}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 7, marginTop: 9 }}>
            {state.checks.map((check) => (
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
