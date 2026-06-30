"use client";

import { useState } from "react";
import { bayarVisit } from "./actions";

type Line = { deskripsi: string; qty: number; harga: number };
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export function PembayaranForm({ visitId, initialItems }: { visitId: string; initialItems: Line[] }) {
  const [rows, setRows] = useState<Line[]>(initialItems.length ? initialItems : [{ deskripsi: "", qty: 1, harga: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState<"Lunas" | "DP" | "Belum Lunas">("Lunas");
  const [metode, setMetode] = useState("Tunai");
  const [dpAmount, setDpAmount] = useState(0);
  const [dpDate, setDpDate] = useState("");

  const set = (i: number, patch: Partial<Line>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { deskripsi: "", qty: 1, harga: 0 }]);
  const del = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  const subtotal = rows.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.harga) || 0), 0);
  const dpp = Math.max(0, subtotal - discount);
  const tax = Math.round(dpp * 0.11);
  const total = dpp + tax;
  const sisa = paid === "Lunas" ? 0 : paid === "DP" ? Math.max(0, total - dpAmount) : total;

  return (
    <form action={bayarVisit}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="paid_status" value={paid} />
      <input type="hidden" name="metode_bayar" value={metode} />
      <input type="hidden" name="dp_amount" value={dpAmount} />
      <input type="hidden" name="dp_date" value={dpDate} />

      <div className="grid2" style={{ alignItems: "start" }}>
        {/* Line items */}
        <div className="card">
          <div className="card-hd" style={{ justifyContent: "space-between" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <i className="ti ti-receipt" style={{ color: "var(--acc)" }} /> Rincian tagihan
            </span>
            <button type="button" onClick={add} className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}>+ Tambah item</button>
          </div>

          <table className="tbl">
            <thead>
              <tr><th>Item</th><th style={{ width: 50, textAlign: "center" }}>Qty</th><th style={{ width: 110, textAlign: "right" }}>Harga</th><th style={{ width: 100, textAlign: "right" }}>Subtotal</th><th style={{ width: 28 }} /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input className="fi" value={r.deskripsi} placeholder="Jasa / obat" onChange={(e) => set(i, { deskripsi: e.target.value })} /></td>
                  <td><input className="fi" type="number" min={1} value={r.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} style={{ textAlign: "center" }} /></td>
                  <td><input className="fi" type="number" min={0} step={500} value={r.harga} onChange={(e) => set(i, { harga: Number(e.target.value) })} style={{ textAlign: "right" }} /></td>
                  <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp((Number(r.qty) || 0) * (Number(r.harga) || 0))}</td>
                  <td style={{ textAlign: "center" }}>
                    <button type="button" onClick={() => del(i)} className="back-btn" style={{ color: "#b91c1c" }} title="Hapus"><i className="ti ti-trash" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 7 }}>Item & harga bisa diedit kasir sebelum pembayaran (PRD §3.10).</div>
        </div>

        {/* Pembayaran */}
        <div className="card">
          <div className="card-hd"><i className="ti ti-cash" style={{ color: "#16a34a" }} /> Pembayaran</div>

          <SummaryRow label="Subtotal" value={rp(subtotal)} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: ".5px solid var(--bd)" }}>
            <span style={{ fontSize: 11, color: "var(--tm)" }}>Diskon</span>
            <input className="fi" type="number" min={0} step={1000} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 120, textAlign: "right" }} />
          </div>
          <SummaryRow label="PPN 11%" value={rp(tax)} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderBottom: "1px solid var(--bd)" }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Total</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--acc)" }}>{rp(total)}</span>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="flab">Metode pembayaran</label>
            <select className="fi" value={metode} onChange={(e) => setMetode(e.target.value)}>
              <option>Tunai</option><option>QRIS</option><option>Transfer</option><option>Debit</option>
            </select>
          </div>

          <div style={{ marginTop: 12 }}>
            <label className="flab">Status pembayaran</label>
            <div style={{ display: "flex", gap: 5 }}>
              {(["Lunas", "DP", "Belum Lunas"] as const).map((s) => (
                <button type="button" key={s} onClick={() => setPaid(s)} className="back-btn" style={{
                  flex: 1, padding: "6px 0", justifyContent: "center", borderRadius: 6, border: ".5px solid var(--bd)", fontSize: 11,
                  background: paid === s ? "var(--sb)" : "#fff", color: paid === s ? "#fff" : "var(--tm)",
                }}>{s}</button>
              ))}
            </div>
          </div>

          {paid === "DP" && (
            <div className="frow" style={{ marginTop: 10 }}>
              <div>
                <label className="flab">Jumlah DP</label>
                <input className="fi" type="number" min={0} step={1000} value={dpAmount} onChange={(e) => setDpAmount(Number(e.target.value))} />
              </div>
              <div>
                <label className="flab">Tanggal DP</label>
                <input className="fi" type="date" value={dpDate} onChange={(e) => setDpDate(e.target.value)} />
              </div>
            </div>
          )}

          {paid !== "Lunas" && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}>
              <span style={{ color: "var(--tm)" }}>Sisa</span>
              <span style={{ fontWeight: 600, color: "#b91c1c" }}>{rp(sisa)}</span>
            </div>
          )}

          <button type="submit" className="pay-btn" style={{ marginTop: 14 }}>
            <i className="ti ti-circle-check" /> Proses pembayaran &amp; selesai
          </button>
        </div>
      </div>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: ".5px solid var(--bd)", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
