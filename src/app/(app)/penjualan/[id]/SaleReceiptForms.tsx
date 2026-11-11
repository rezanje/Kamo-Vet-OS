"use client";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { NumberInput } from "@/components/NumberInput";
import { formatPosMoney } from "@/lib/pos-money";
import { batalkanPenerimaan, batalkanPencairan, terimaPembayaranUlang } from "./actions";

const METHODS = ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"] as const;

/** Rupiah ke sen; kosong = 0; null bila bukan angka Rupiah dengan maksimal dua desimal. */
function cents(value: string): number | null {
  const text = value.trim();
  if (!text) return 0;
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimal = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

/** Tombol "Batalkan penerimaan": konfirmasi + alasan wajib. Uang keluar dari kas/bank, struk menjadi belum dibayar. */
export function SaleReceiptCancelForm({ userId, saleId, revision, total, shiftClosed }: {
  userId: string; saleId: string; revision: number; total: number; shiftClosed: boolean;
}) {
  return <CorrectionTransactionForm userId={userId} scope={`sale-receipt-cancel:${saleId}:${revision}`} action={batalkanPenerimaan}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p><strong>Batalkan penerimaan</strong> (gaya Accurate): pembayaran {formatPosMoney(total)} dikeluarkan dari kas/bank (jurnal dibalik, catatan tersimpan,
        tidak ada yang dihapus) dan struk menjadi <em>belum dibayar</em>. Stok, HPP, dan pendapatan tidak berubah.
        Sesudahnya Anda bisa <strong>Terima pembayaran</strong> lagi (metode boleh diganti), atau <strong>Ubah transaksi</strong> (harga, jumlah, barang, voucher) lewat kasir.</p>
      {shiftClosed && <p role="note">Shift struk ini sudah ditutup. Angka tutup shift lama tidak diubah; pengembalian uang dicatat di shift kasir yang sedang terbuka di cabang ini.
        Bila struk dibayar tunai dan tidak ada shift terbuka, buka shift dulu.</p>}
      <label className="flab" htmlFor="receipt-cancel-reason">Alasan membatalkan penerimaan *</label>
      <input id="receipt-cancel-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: pelanggan bayar QRIS, kasir memilih tunai" />
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" name="konfirmasi" value="ya" required /> Saya mengerti: uang pembayaran dikeluarkan dari kas/bank dan struk menjadi belum dibayar.
      </label>
      <button className="btn-def" type="submit" disabled={!ready} style={{ marginTop: 10 }}>Batalkan penerimaan</button>
    </>}
  </CorrectionTransactionForm>;
}

/** Terima pembayaran lagi: bagian metode diisi dari penerimaan lama; jumlahnya harus sama dengan total struk. */
export function SaleReceiveAgainForm({ userId, saleId, revision, total, previous }: {
  userId: string; saleId: string; revision: number; total: number; previous: { method: string; amount: number }[];
}) {
  const initial = Object.fromEntries(METHODS.map(method => [method, String(previous.find(part => part.method === method)?.amount ?? "")]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const parsed = METHODS.map(method => cents(values[method] ?? ""));
  const bad = parsed.some(value => value === null);
  const sum = bad ? 0 : parsed.reduce<number>((a, b) => a + (b ?? 0), 0);
  const totalCents = Math.round(total * 100);
  const balanced = !bad && sum === totalCents && parsed.some(value => (value ?? 0) > 0);
  const hint = bad ? "Isi angka Rupiah tanpa titik pemisah ribuan, maksimal dua desimal."
    : !balanced ? `Jumlah sekarang ${formatPosMoney(sum / 100)}, harus sama dengan total struk ${formatPosMoney(total)}.` : "";
  return <CorrectionTransactionForm userId={userId} scope={`sale-receipt-receive:${saleId}:${revision}`} action={terimaPembayaranUlang}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p><strong>Terima pembayaran</strong>: catat penerimaan lagi untuk struk ini (jumlah harus sama dengan total {formatPosMoney(total)}). Kolom sudah berisi penerimaan sebelumnya; ubah bila metodenya berbeda.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {METHODS.map(method => <div key={method}>
          <label className="flab" htmlFor={`receipt-receive-${method}`}>{method}</label>
          <NumberInput id={`receipt-receive-${method}`} className="fi" name={`amount_${method}`} type="number" min="0" max="1000000000000" step="0.01" inputMode="decimal" placeholder="0"
            value={values[method]} onInput={event => { const text = event.currentTarget.value; setValues(current => ({ ...current, [method]: text })); }} />
        </div>)}
      </div>
      {hint && <p role="status">{hint}</p>}
      <button className="btn-acc" type="submit" disabled={!ready || !balanced} style={{ marginTop: 10 }}>Terima pembayaran</button>
    </>}
  </CorrectionTransactionForm>;
}

/** Order marketplace yang sudah dicairkan: batalkan pencairan -> kembali ke piutang marketplace. */
export function OnlineDisbursementCancelForm({ userId, saleId, revision }: { userId: string; saleId: string; revision: number }) {
  return <CorrectionTransactionForm userId={userId} scope={`sale-disbursement-cancel:${saleId}:${revision}`} action={batalkanPencairan}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p><strong>Batalkan pencairan</strong>: dana yang tercatat masuk bank dan potongan komisi platform dibalik, order kembali menjadi <em>piutang marketplace</em>.
        Setelah itu order bisa dicairkan ulang dengan nominal yang benar, atau dibatalkan/diganti.</p>
      <label className="flab" htmlFor="disb-cancel-reason">Alasan membatalkan pencairan *</label>
      <input id="disb-cancel-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: nominal pencairan salah ketik" />
      <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" name="konfirmasi" value="ya" required /> Saya mengerti: dana dikeluarkan dari bank dan order kembali menjadi piutang marketplace.
      </label>
      <button className="btn-def" type="submit" disabled={!ready} style={{ marginTop: 10 }}>Batalkan pencairan</button>
    </>}
  </CorrectionTransactionForm>;
}
