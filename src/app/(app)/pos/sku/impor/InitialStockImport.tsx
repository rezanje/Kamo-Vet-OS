"use client";

import { useState, useTransition } from "react";
import {
  postSaldoAwalAccurate,
  previewSaldoAwalAccurate,
  type InitialStockState,
} from "./actions";

type Option = { id: string; name: string; branch_id?: string };

const rupiah = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const qty = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });

export function InitialStockImport({ branches, warehouses }: { branches: Option[]; warehouses: Option[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [asOf, setAsOf] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<InitialStockState | null>(null);
  const [localError, setLocalError] = useState("");
  const [pending, startTransition] = useTransition();

  const availableWarehouses = warehouses.filter((warehouse) => !warehouse.branch_id || !branchId || warehouse.branch_id === branchId);
  const run = (action: typeof previewSaldoAwalAccurate | typeof postSaldoAwalAccurate) => {
    if (!file || !branchId || !warehouseId || !asOf) {
      setLocalError("Cabang, gudang, tanggal, dan file wajib diisi.");
      return;
    }
    setLocalError("");
    startTransition(async () => {
      const data = new FormData();
      data.append("initial_stock_file", file);
      data.append("branch_id", branchId);
      data.append("warehouse_id", warehouseId);
      data.append("as_of", asOf);
      if (confirmed) data.append("confirm_scope", "on");
      if (action === postSaldoAwalAccurate && state?.run_id) data.append("run_id", state.run_id);
      setState(await action(data));
    });
  };

  return (
    <section className="crm-sec" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--sb)" }}>Impor Saldo Awal Accurate</div>
      <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3, lineHeight: 1.55 }}>
        Stok diposting ke satu gudang dan tanggal pilihan. HPP serta kuantitas dikonversi ke satuan dasar.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginTop: 12 }}>
        <label className="flab">Cabang
          <select className="fi" value={branchId} onChange={(event) => { setBranchId(event.target.value); setWarehouseId(""); setState(null); }}>
            <option value="">Pilih cabang…</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label className="flab">Gudang
          <select className="fi" value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setState(null); }}>
            <option value="">Pilih gudang…</option>
            {availableWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>
        <label className="flab">Tanggal saldo
          <input className="fi" type="date" value={asOf} onChange={(event) => { setAsOf(event.target.value); setState(null); }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <label className="btn-def" style={{ cursor: "pointer" }}>
          <i className="ti ti-file-spreadsheet" /> Pilih Saldo Awal .xlsx
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: "none" }}
            onChange={(event) => { setFile(event.target.files?.[0] ?? null); setState(null); setLocalError(""); }} />
        </label>
        {file && <span style={{ fontSize: 11, color: "var(--tm)" }}>{file.name}</span>}
        <button type="button" className="btn-acc" disabled={pending || !file} onClick={() => run(previewSaldoAwalAccurate)}>
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
            <span>Saya sudah mencocokkan gudang dan tanggal saldo.</span>
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
