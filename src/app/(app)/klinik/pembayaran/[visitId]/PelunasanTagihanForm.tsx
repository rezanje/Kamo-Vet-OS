"use client";
import { useState } from "react";
import { PreservedForm } from "@/components/LocalTransactionDraft";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { METODE_PELUNASAN, totalBagian, type MetodePelunasan } from "@/lib/pelunasan-klinik";
import { lunasiTagihanKlinik } from "./pelunasan-actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
type Baris = { key: number; method: MetodePelunasan; amount: number };

/**
 * Pintu pelunasan tagihan rawat jalan DP/Belum Lunas untuk kasir klinik. DP dan
 * pembayaran sebelumnya ditampilkan SEKALI sebagai "Sudah diterima"; yang ditagih
 * hanya sisanya, pada invoice yang sama. Basis data memeriksa ulang sisa di bawah kunci.
 */
export function PelunasanTagihanForm({ visitId, invoiceId, invoiceNo, total, diterima, sisa, requestKey }: {
  visitId: string; invoiceId: string; invoiceNo: string; total: number; diterima: number; sisa: number; requestKey: string;
}) {
  const [rows, setRows] = useState<Baris[]>([{ key: 0, method: "Tunai", amount: sisa }]);
  const jumlah = totalBagian(rows);
  const masalah = rows.some(row => !Number.isSafeInteger(row.amount) || row.amount <= 0)
    ? "Isi nominal tiap metode dengan rupiah bulat lebih dari nol."
    : jumlah > sisa ? `Total ${rp(jumlah)} melebihi sisa ${rp(sisa)}.` : "";
  const ubah = (i: number, patch: Partial<Baris>) => setRows(rows.map((row, j) => j === i ? { ...row, ...patch } : row));
  const parts = rows.map(({ method, amount }) => ({ method, amount }));

  return (
    <div className="card" style={{ marginBottom: 12, borderColor: "#fcd34d" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
        <i className="ti ti-cash" /> Pelunasan tagihan {invoiceNo}
      </div>
      <div style={{ maxWidth: 320, fontSize: 12 }}>
        <RingkasBaris label="Total tagihan" value={rp(total)} />
        <RingkasBaris label="Sudah diterima (DP & pembayaran sebelumnya)" value={rp(diterima)} />
        <RingkasBaris label="Sisa yang harus dibayar" value={rp(sisa)} strong />
      </div>
      <p style={{ fontSize: 10.5, color: "var(--tm)", margin: "6px 0 8px" }}>
        Uang masuk laci shift klinik kamu pada tagihan yang sama. Barang tidak dikeluarkan lagi dan tagihan tidak dibuat ulang.
      </p>
      <PreservedForm action={lunasiTagihanKlinik}>
        <input type="hidden" name="visitId" value={visitId} />
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <input type="hidden" name="request_key" value={requestKey} />
        <input type="hidden" name="expected_remaining" value={String(sisa)} />
        <input type="hidden" name="parts" value={JSON.stringify(parts)} />
        {rows.map((row, i) => (
          <div key={row.key} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 6, flexWrap: "wrap" }}>
            <label className="flab">Metode
              <select className="fi" aria-label={`Metode pembayaran ${i + 1}`} value={row.method}
                onChange={e => ubah(i, { method: e.target.value as MetodePelunasan })} style={{ width: 120 }}>
                {METODE_PELUNASAN.map(method => <option key={method} value={method}>{method}</option>)}
              </select>
            </label>
            <label className="flab">Nominal
              <NumberInput className="fi" aria-label={`Nominal pembayaran ${i + 1}`} type="number" min={1} step={1}
                value={row.amount || ""} onChange={e => ubah(i, { amount: Number(e.target.value) })} style={{ width: 140 }} />
            </label>
            {rows.length > 1 && (
              <button type="button" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5 }}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}>Hapus</button>
            )}
          </div>
        ))}
        {rows.length < 6 && (
          <button type="button" className="btn-def" style={{ padding: "4px 9px", fontSize: 10.5, marginBottom: 8 }}
            onClick={() => setRows([...rows, { key: Math.max(...rows.map(row => row.key)) + 1, method: "Transfer", amount: Math.max(0, sisa - jumlah) }])}>
            <i className="ti ti-plus" /> Tambah metode (bayar campuran)
          </button>
        )}
        {masalah && <div role="alert" style={{ fontSize: 11, color: "#b91c1c", marginBottom: 6 }}>{masalah}</div>}
        <div style={{ fontSize: 11, marginBottom: 6 }}>
          Diterima sekarang {rp(jumlah)}{jumlah < sisa && !masalah ? ` · sisa setelah ini ${rp(sisa - jumlah)}` : ""}
        </div>
        <SubmitButton className="btn-acc" icon="ti-cash" disabled={!!masalah} pendingText="Menyimpan pelunasan…">Terima Pelunasan</SubmitButton>
      </PreservedForm>
    </div>
  );
}

function RingkasBaris({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", fontWeight: strong ? 700 : 400 }}>
      <span style={{ color: strong ? undefined : "var(--tm)" }}>{label}</span><span>{value}</span>
    </div>
  );
}
