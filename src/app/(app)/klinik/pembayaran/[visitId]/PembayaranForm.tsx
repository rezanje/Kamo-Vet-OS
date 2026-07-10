"use client";

import { useState } from "react";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { bayarVisit } from "./actions";

type Line = { deskripsi: string; qty: number; harga: number };
type Patient = {
  photo: string | null; name: string; species: string; owner: string; phone: string; address: string;
  dokter: string; jenisLayanan: string; noInvoice: string; tanggal: string;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const METODE = [
  { m: "Tunai", ic: "ti-cash", desc: "Bayar dengan uang tunai" },
  { m: "Transfer", ic: "ti-building-bank", desc: "Bayar melalui transfer bank" },
  { m: "Kartu", ic: "ti-credit-card", desc: "Bayar dengan kartu debit atau kredit" },
  { m: "QRIS", ic: "ti-qrcode", desc: "Bayar menggunakan QRIS" },
  { m: "E-Wallet", ic: "ti-wallet", desc: "Bayar menggunakan e-wallet" },
];

function ItemTable({ title, icon, color, rows, setRows }: {
  title: string; icon: string; color: string; rows: Line[]; setRows: (r: Line[]) => void;
}) {
  const set = (i: number, patch: Partial<Line>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows([...rows, { deskripsi: "", qty: 1, harga: 0 }]);
  const del = (i: number) => setRows(rows.filter((_, j) => j !== i));
  const subtotal = rows.reduce((a, r) => a + r.qty * r.harga, 0);

  return (
    <div style={{ border: ".5px solid var(--bd)", borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color }}>
          <i className={`ti ${icon}`} /> {title}
        </div>
        <button type="button" onClick={add} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }}><i className="ti ti-plus" /> Tambah</button>
      </div>
      <table className="tbl">
        <thead><tr><th style={{ width: 26 }}>No.</th><th>Nama</th><th style={{ width: 54, textAlign: "center" }}>Qty</th><th style={{ width: 110, textAlign: "right" }}>Harga Satuan</th><th style={{ width: 100, textAlign: "right" }}>Subtotal</th><th style={{ width: 24 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
              <td><input className="fi" value={r.deskripsi} placeholder="Nama item" onChange={(e) => set(i, { deskripsi: e.target.value })} /></td>
              <td><input className="fi" type="number" min={1} value={r.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} style={{ textAlign: "center" }} /></td>
              <td><input className="fi" type="number" min={0} step={500} value={r.harga} onChange={(e) => set(i, { harga: Number(e.target.value) })} style={{ textAlign: "right" }} /></td>
              <td style={{ textAlign: "right", fontSize: 11, fontWeight: 500 }}>{rp(r.qty * r.harga)}</td>
              <td style={{ textAlign: "center" }}><i className="ti ti-x" onClick={() => del(i)} style={{ cursor: "pointer", color: "#dc2626" }} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", fontSize: 10.5, padding: "10px 0" }}>Belum ada item.</td></tr>}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 6, fontSize: 11.5 }}>
        <span style={{ fontWeight: 600, color: "var(--tm)" }}>Subtotal {title.split(" ")[0]}</span>
        <span style={{ fontWeight: 700 }}>{rp(subtotal)}</span>
      </div>
    </div>
  );
}

export function PembayaranForm({ visitId, patient, initialObat, initialJasa, catatanResep, initialDiscount = 0, initialDpAmount = 0, initialDpDate = null, editMode = false }: {
  visitId: string; patient: Patient; initialObat: Line[]; initialJasa: Line[]; catatanResep: string | null;
  initialDiscount?: number; initialDpAmount?: number; initialDpDate?: string | null; editMode?: boolean;
}) {
  const [obat, setObat] = useState<Line[]>(initialObat);
  const [jasa, setJasa] = useState<Line[]>(initialJasa);
  const [discount, setDiscount] = useState(initialDiscount);
  const [metode, setMetode] = useState("Tunai");
  const [reason, setReason] = useState("");

  const subtotal = [...obat, ...jasa].reduce((a, r) => a + r.qty * r.harga, 0);
  const dpp = Math.max(0, subtotal - discount);
  const tax = Math.round(dpp * 0.11);
  const total = dpp + tax;
  const dpPaid = initialDpAmount;
  const sisa = Math.max(0, total - dpPaid);

  const [bayar, setBayar] = useState(0);
  const totalDiterima = dpPaid + bayar;
  const kembalian = Math.max(0, bayar - sisa);
  const paidStatus = totalDiterima >= total && total > 0 ? "Lunas" : totalDiterima > 0 ? "DP" : "Belum Lunas";
  const statusColor = paidStatus === "Lunas" ? "#15803d" : paidStatus === "DP" ? "#7c3aed" : "#b91c1c";

  const items = JSON.stringify([
    ...obat.map((r) => ({ ...r, jenis: "obat" })),
    ...jasa.map((r) => ({ ...r, jenis: "jasa" })),
  ].filter((r) => r.deskripsi.trim()));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={bayarVisit}>
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="items" value={items} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="paid_status" value={paidStatus} />
      <input type="hidden" name="metode_bayar" value={metode} />
      <input type="hidden" name="dp_amount" value={totalDiterima} />
      <input type="hidden" name="dp_date" value={initialDpDate ?? today} />
      {editMode && <input type="hidden" name="edit_reason" value={reason} />}

      {/* Header pasien */}
      <div className="card" style={{ marginBottom: 14, padding: 18 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div style={{ width: 96, height: 96, borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 40, color: "var(--td)" }} />}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 19, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
              <span className="bge b">{patient.species}</span>
            </div>
            <Pair label="Pemilik" value={patient.owner} />
            <Pair label="No. HP" value={patient.phone} />
            <Pair label="Alamat" value={patient.address} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Pair label="No. Invoice" value={patient.noInvoice} />
            <Pair label="Tanggal" value={patient.tanggal} />
            <Pair label="Dokter" value={patient.dokter} />
            <Pair label="Jenis Layanan" value={patient.jenisLayanan} />
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 14, alignItems: "start" }}>
        {/* ===== KIRI: rincian tagihan ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#2563eb", letterSpacing: ".02em", marginBottom: 12, borderBottom: "2px solid #2563eb", paddingBottom: 8, display: "inline-block" }}>
            <i className="ti ti-clipboard-list" /> RINCIAN TAGIHAN
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".03em", marginBottom: 10 }}>RINCIAN LAYANAN DAN OBAT</div>

          <ItemTable title="OBAT" icon="ti-pill" color="#7c3aed" rows={obat} setRows={setObat} />
          <ItemTable title="JASA / Tindakan" icon="ti-stethoscope" color="#2563eb" rows={jasa} setRows={setJasa} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
            <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#1d4ed8", marginBottom: 4 }}>CATATAN RESEP</div>
              <div style={{ fontSize: 11, color: "var(--tm)", lineHeight: 1.5 }}>{catatanResep || "—"}</div>
            </div>
            <div>
              <SumRow label="Subtotal (Obat + Jasa)" value={rp(subtotal)} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0" }}>
                <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Diskon</span>
                <input className="fi" type="number" min={0} step={1000} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={{ width: 100, textAlign: "right" }} />
              </div>
              <SumRow label="PPN 11%" value={rp(tax)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1.5px solid var(--bd)" }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)" }}>TOTAL TAGIHAN</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: "#2563eb" }}>{rp(total)}</span>
              </div>
            </div>
          </div>
          {editMode && (
            <div style={{ marginTop: 12 }}>
              <label className="flab">Alasan perubahan (wajib bila nominal/item berubah)</label>
              <input className="fi" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. salah input harga obat" />
            </div>
          )}
        </div>

        {/* ===== KANAN: panel pembayaran ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Status */}
          <div className="card" style={{ background: paidStatus === "Lunas" ? "#f0fdf4" : "#fff", borderColor: statusColor }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: statusColor, letterSpacing: ".02em" }}>STATUS PEMBAYARAN</span>
              <span className={`bge ${paidStatus === "Lunas" ? "g" : paidStatus === "DP" ? "pu" : "r"}`}>{paidStatus.toUpperCase()}</span>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Total Tagihan</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--sb)", lineHeight: 1.2 }}>{rp(total)}</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Sisa yang Harus Dibayar</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: statusColor }}>{rp(Math.max(0, total - totalDiterima))}</div>
          </div>

          {/* Ringkasan */}
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#2563eb", marginBottom: 8 }}>RINGKASAN PEMBAYARAN</div>
            <SumRow label="Total Tagihan" value={rp(total)} />
            <SumRow label="Total Pembayaran" value={rp(totalDiterima)} />
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--bd)" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Sisa yang Harus Dibayar</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: statusColor }}>{rp(Math.max(0, total - totalDiterima))}</span>
            </div>
          </div>

          {/* DP */}
          {dpPaid > 0 && (
            <div className="card" style={{ borderColor: "#c4b5fd" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#7c3aed" }}>DP PEMBAYARAN</span>
                <span className="bge pu">DP DIBAYAR</span>
              </div>
              <SumRow label="Tanggal DP" value={initialDpDate ?? "—"} />
              <SumRow label="Jumlah DP" value={rp(dpPaid)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--bd)" }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Sisa Setelah DP</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}>{rp(sisa)}</span>
              </div>
            </div>
          )}

          {/* Metode */}
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#2563eb", marginBottom: 8 }}>PILIH METODE PEMBAYARAN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {METODE.map(({ m, ic, desc }) => (
                <button key={m} type="button" onClick={() => setMetode(m)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                  border: `1.5px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "#eff4ff" : "#fff",
                }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", border: `2px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "var(--posb)" : "#fff", boxShadow: metode === m ? "inset 0 0 0 2.5px #fff" : "none", flexShrink: 0 }} />
                  <i className={`ti ${ic}`} style={{ fontSize: 18, color: metode === m ? "var(--posb)" : "var(--tm)" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{m}</div>
                    <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Penerimaan */}
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "#2563eb", marginBottom: 8 }}>PENERIMAAN PEMBAYARAN</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Jumlah Bayar</span>
              <input className="fi" type="number" min={0} step={1000} value={bayar || ""} onChange={(e) => setBayar(Number(e.target.value))} style={{ width: 130, textAlign: "right" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#15803d" }}>Kembalian</span>
              <span style={{ fontWeight: 700, color: "#15803d" }}>{rp(kembalian)}</span>
            </div>
          </div>

          {/* Aksi */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 6 }}>
            {editMode ? (
              <Link href={`/klinik/pembayaran/${visitId}/invoice`} className="btn-def" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", fontSize: 11, textDecoration: "none" }}>
                <i className="ti ti-printer" /> Cetak
              </Link>
            ) : (
              <span className="btn-def" title="Simpan invoice dulu sebelum cetak" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", fontSize: 11, opacity: 0.5, cursor: "not-allowed" }}>
                <i className="ti ti-printer" /> Cetak
              </span>
            )}
            <SubmitButton className="btn-acc" name="finalize" value="0" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ justifyContent: "center", padding: "9px 0", background: "#2563eb" }}>Simpan</SubmitButton>
            <SubmitButton className="kpos-bayar" name="finalize" value="1" icon="ti-circle-check" pendingText="Memproses…" style={{ background: "#16a34a" }}>Bayar &amp; Selesai</SubmitButton>
          </div>
        </div>
      </div>
    </form>
  );
}

function Pair({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 6, padding: "2px 0", fontSize: 12 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}
