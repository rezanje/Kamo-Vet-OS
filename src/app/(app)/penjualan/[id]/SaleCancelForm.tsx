"use client";

import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { batalkanPenjualan } from "./actions";

export function SaleCancelForm({ userId, saleId, revision }: { userId: string; saleId: string; revision: number }) {
  return <CorrectionTransactionForm userId={userId} scope={`sale-cancel:${saleId}:${revision}`} action={batalkanPenjualan}>
    {({ ready }) => <>
      <input type="hidden" name="id" value={saleId} /><input type="hidden" name="revision" value={revision} />
      <p>Penjualan lama dibatalkan dengan riwayat lengkap. Jika pembayaran sudah diterima, pastikan uang dikembalikan sesuai metode semula. Untuk koreksi, lanjutkan ke transaksi pengganti lalu periksa harga dan pembayarannya.</p>
      <label className="flab" htmlFor="sale-cancel-reason">Alasan pembatalan atau koreksi *</label>
      <input id="sale-cancel-reason" className="fi" name="alasan" minLength={3} maxLength={1000} required placeholder="Contoh: barang yang dimasukkan salah" />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn-def" name="tindakan" value="batal" disabled={!ready}>Batalkan penjualan</button>
        <button className="btn-acc" name="tindakan" value="ganti" disabled={!ready}>Batalkan &amp; siapkan pengganti</button>
      </div>
    </>}
  </CorrectionTransactionForm>;
}
