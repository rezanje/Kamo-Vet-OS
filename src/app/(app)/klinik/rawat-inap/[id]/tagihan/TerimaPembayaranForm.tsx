"use client";
import { useMemo, useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { alokasiPembayaran, type RingkasTahap } from "@/lib/tagihan-berjalan";
import { terimaPembayaran } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
type Bagian = { method: string; amount: string };

/**
 * Terima pembayaran rawat inap: berapa kali pun, campuran metode boleh.
 *
 * Alokasinya dihitung ulang server (tahap tertua lebih dulu, atau tagihan yang dipilih
 * kasir); pratinjau di sini memakai fungsi yang sama persis supaya angka yang disebutkan
 * ke pemilik tidak berbeda dari kwitansinya.
 */
export function TerimaPembayaranForm({
  recordId, visitId, requestKey, tahap, dpOpsional,
}: { recordId: string; visitId: string; requestKey: string; tahap: RingkasTahap[]; dpOpsional?: number }) {
  const [bagian, setBagian] = useState<Bagian[]>([{ method: "Tunai", amount: "" }]);
  const [invoiceId, setInvoiceId] = useState("");
  const belumLunas = tahap.filter((t) => t.sisa > 0);

  const parts = useMemo(
    () => bagian.map((b) => ({ method: b.method, amount: Math.trunc(Number(b.amount) || 0) }))
      .filter((b) => b.amount > 0),
    [bagian],
  );
  const total = parts.reduce((sum, p) => sum + p.amount, 0);
  const alokasi = useMemo(
    () => alokasiPembayaran(tahap, parts, invoiceId || null), [tahap, parts, invoiceId],
  );

  const ubah = (i: number, patch: Partial<Bagian>) =>
    setBagian((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  return (
    <form action={terimaPembayaran}>
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="parts" value={JSON.stringify(parts)} />
      <input type="hidden" name="invoice_id" value={invoiceId} />

      {dpOpsional !== undefined && (
        <div style={{ marginBottom: 12, fontSize: 11.5 }}>
          <div>DP lanjutan opsional: <b>{rp(dpOpsional)}</b> (50% sisa total transaksi, termasuk seluruh estimasi pending dan setelah semua pembayaran).</div>
          <div>Boleh bayar nanti atau ubah nominal. Ini hanya draft; uang baru diterima saat menekan Terima pembayaran.</div>
          <button type="button" className="btn-def" aria-label="Isi DP 50% sisa total"
            disabled={dpOpsional <= 0 || bagian.some((b) => b.amount.trim() !== "" && Number(b.amount) !== 0)}
            onClick={() => setBagian((prev) => prev.map((b, i) => i === 0 ? { ...b, amount: String(dpOpsional) } : b))}>
            Isi saran 50% sisa total
          </button>
          <div>Jika nominal sudah diisi, edit manual atau kosongkan dulu; bagian dan metode yang diketik tidak ditimpa.</div>
        </div>
      )}

      {bagian.map((b, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 7 }}>
          <div className="fg" style={{ margin: 0, minWidth: 130 }}>
            <label className="flab" htmlFor={`metode-${i}`}>Metode {i + 1}</label>
            <select className="fi" id={`metode-${i}`} value={b.method}
              onChange={(e) => ubah(i, { method: e.target.value })}>
              {METODE_BAYAR.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="fg" style={{ margin: 0, minWidth: 150 }}>
            <label className="flab" htmlFor={`jumlah-${i}`}>Jumlah (Rp)</label>
            <NumberInput className="fi" id={`jumlah-${i}`} type="number" min={0} step={1}
              value={b.amount} onChange={(e) => ubah(i, { amount: e.currentTarget.value })} />
          </div>
          {bagian.length > 1 && (
            <button type="button" className="btn-def" style={{ padding: "6px 10px", fontSize: 10.5 }}
              onClick={() => setBagian((prev) => prev.filter((_, idx) => idx !== i))}>
              <i className="ti ti-trash" /> Hapus
            </button>
          )}
        </div>
      ))}
      {bagian.length < 6 && (
        <button type="button" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5 }}
          onClick={() => setBagian((prev) => [...prev, { method: "Transfer", amount: "" }])}>
          <i className="ti ti-plus" /> Tambah metode (pembayaran campuran)
        </button>
      )}

      <div className="fg" style={{ marginTop: 10, maxWidth: 340 }}>
        <label className="flab" htmlFor="tagihan-dipilih">Dahulukan tagihan</label>
        <select className="fi" id="tagihan-dipilih" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          <option value="">Tahap tertua lebih dulu</option>
          {belumLunas.map((t) => (
            <option key={t.id} value={t.id}>{t.invoice_no ?? "(tanpa nomor)"} · sisa {rp(t.sisa)}</option>
          ))}
        </select>
      </div>
      <div className="fg" style={{ maxWidth: 340 }}>
        <label className="flab" htmlFor="catatan-bayar">Catatan (opsional)</label>
        <input className="fi" id="catatan-bayar" name="catatan" maxLength={200} />
      </div>

      <div style={{ fontSize: 11.5, marginTop: 8 }}>
        <div>Total diterima: <b>{rp(total)}</b></div>
        {alokasi.baris.map((a, i) => (
          <div key={i} style={{ color: "var(--tm)" }}>
            {a.invoiceNo ?? "(tanpa nomor)"} ← {a.method} {rp(a.amount)}
          </div>
        ))}
        {alokasi.uangMuka > 0 && (
          <div style={{ color: "#b45309" }}>
            Sisa {rp(alokasi.uangMuka)} disimpan sebagai uang muka pemilik dan otomatis memotong tagihan tahap berikutnya.
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
        <SubmitButton className="btn-acc" icon="ti-cash" pendingText="Menyimpan…" disabled={total <= 0}>
          Terima pembayaran
        </SubmitButton>
      </div>
    </form>
  );
}
