"use client";

/** P04: peringatan per baris. Tidak memblokir; hanya minta pengguna memeriksa. */
export function PriceDeviationHint({ warning }: { warning: string | null }) {
  if (!warning) return null;
  return <div role="status" style={{ fontSize: 10, color: "#92400e", marginTop: 2 }}>
    <i className="ti ti-alert-triangle" /> {warning}
  </div>;
}

/**
 * P04: selama ada baris yang menyimpang > 50% dari HPP, simpan butuh centang konfirmasi.
 * Kotak `required` membuat browser menahan submit sampai dicentang; tanpa baris menyimpang
 * kotak tidak dirender sama sekali.
 */
export function PriceDeviationConfirm({ count }: { count: number }) {
  if (count <= 0) return null;
  return <div className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 10 }}>
    <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer" }}>
      {/* key: jumlah baris berubah = konfirmasi lama tidak berlaku, harus dicentang ulang. */}
      <input key={count} type="checkbox" name="konfirmasi_harga" value="1" required />
      <span>{count} baris punya harga beli yang menyimpang lebih dari 50% dari HPP rata-rata. Saya sudah memeriksa satuan dan harganya, simpan apa adanya.</span>
    </label>
  </div>;
}
