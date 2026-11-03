"use client";

import { useEffect, useRef, useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { NumberInput } from "@/components/NumberInput";
import { formatPosMoney } from "@/lib/pos-money";
import { SALE_PAYMENT_METHODS } from "@/lib/sale-payment-reporting";
import { koreksiMetodePembayaran } from "./actions";

/** Blank counts as zero: clearing a box means "nothing paid this way". */
function cents(value: string): number | null {
  const text = value.trim();
  if (!text) return 0;
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

type Part = { method: string; amount: number };

/**
 * Koreksi metode bayar penjualan POS ke semua metode kasir (Tunai, Transfer, Debit,
 * Kredit, QRIS, E-Wallet). Bagian yang kena fee merchant tetap dan tidak bisa diubah.
 */
export function SalePaymentCorrectionForm({ userId, saleId, revision, movable, fixed, change = 0 }: {
  userId: string; saleId: string; revision: number;
  /** Bagian tanpa fee merchant — inilah yang dibagi ulang. */
  movable: Part[];
  /** Bagian ber-fee merchant: tetap, metodenya tidak bisa dipakai di pembagian baru. */
  fixed: Part[];
  /** Kembalian tunai yang tercatat saat checkout. */
  change?: number;
}) {
  const methods = SALE_PAYMENT_METHODS.filter(m => !fixed.some(part => part.method === m));
  const initial = Object.fromEntries(methods.map(m => {
    const amount = movable.find(part => part.method === m)?.amount ?? 0;
    return [m, amount ? String(amount) : ""];
  })) as Record<string, string>;
  const [texts, setTexts] = useState<Record<string, string>>(initial);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const pool = Math.round(movable.reduce((sum, part) => sum + part.amount, 0) * 100);

  // A restored draft writes the DOM directly; mirror it so validation sees the same numbers.
  useEffect(() => {
    const cleanups = methods.map(m => {
      const control = inputs.current[m];
      const sync = () => setTexts(prev => ({ ...prev, [m]: control?.value ?? "" }));
      control?.addEventListener("vetos:numeric-sync", sync);
      return () => control?.removeEventListener("vetos:numeric-sync", sync);
    });
    return () => cleanups.forEach(cleanup => cleanup());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = methods.map(m => ({ method: m, cents: cents(texts[m] ?? "") }));
  const invalid = parsed.some(p => p.cents === null);
  const sum = parsed.reduce((total, p) => total + (p.cents ?? 0), 0);
  const balanced = !invalid && sum === pool;
  const changed = parsed.some(p => p.cents !== Math.round((movable.find(part => part.method === p.method)?.amount ?? 0) * 100));
  const valid = balanced && changed;
  const newCash = parsed.find(p => p.method === "Tunai")?.cents ?? 0;

  const semuaKe = (target: string) => setTexts(Object.fromEntries(methods.map(m => [m, m === target ? String(pool / 100) : ""])));

  const hint = invalid ? "Isi angka Rupiah tanpa titik pemisah ribuan."
    : !balanced ? (sum < pool
      ? `Masih kurang ${formatPosMoney((pool - sum) / 100)} — jumlah semua metode harus ${formatPosMoney(pool / 100)}.`
      : `Kelebihan ${formatPosMoney((sum - pool) / 100)} — jumlah semua metode harus ${formatPosMoney(pool / 100)}.`)
      : !changed ? "Pembagian masih sama dengan semula. Pilih metode yang benar dulu." : "";

  return <CorrectionTransactionForm userId={userId} scope={`sale-payment:${saleId}:${revision}`} action={koreksiMetodePembayaran}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p>Ganti metode pembayaran penjualan ini kalau kasir salah pilih (misalnya pelanggan bayar QRIS tapi tercatat Tunai). Total tagihan tidak berubah. Jurnal lama dibalik dan jurnal baru dicatat dengan alasan koreksi.</p>
      {fixed.length > 0 && <p>Tetap (kena fee merchant, tidak bisa diubah): {fixed.map(part => `${part.method} ${formatPosMoney(part.amount)}`).join(" · ")}</p>}
      <p>Total yang dibagi: <strong>{formatPosMoney(pool / 100)}</strong></p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {methods.map(m => (
          <button key={m} type="button" className="btn-def" style={{ fontSize: 11 }} onClick={() => semuaKe(m)}>
            Semua ke {m}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {methods.map(m => (
          <div key={m}>
            <label className="flab" htmlFor={`sale-correction-${m}`}>{m}</label>
            <NumberInput ref={el => { inputs.current[m] = el; }} id={`sale-correction-${m}`} className="fi" name={`bayar_${m}`}
              type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" placeholder="0"
              value={texts[m] ?? ""} onInput={event => { const value = event.currentTarget.value; setTexts(prev => ({ ...prev, [m]: value })); }} />
          </div>
        ))}
      </div>
      {change > 0 && <p>Kembalian tercatat {formatPosMoney(change)}. {newCash === 0
        ? "Karena tidak ada lagi bagian Tunai, kembalian dihapus dan nilai Dibayar disamakan dengan total."
        : "Bila bagian Tunai dikosongkan, kembalian ikut dihapus dan nilai Dibayar disamakan dengan total."}</p>}
      {hint && <p role="status">{hint}</p>}
      <label className="flab" htmlFor="sale-correction-reason">Alasan koreksi *</label>
      <input id="sale-correction-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: pelanggan bayar QRIS, kasir memilih tunai" />
      <button className="btn-acc" type="submit" disabled={!ready || !valid} style={{ marginTop: 10 }}>Simpan koreksi metode</button>
    </>}
  </CorrectionTransactionForm>;
}
