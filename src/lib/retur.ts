// Logika murni Retur Pembelian/Penjualan — dites di __tests__/retur.test.ts

// Nomor dokumen: RB.YYYY.MM.NNNNN (beli) / RJ.YYYY.MM.NNNNN (jual), seq per bulan.
export function formatNoRetur(jenis: "RB" | "RJ", date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${jenis}.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Sisa qty yang masih boleh diretur per item = qty sumber − akumulasi retur sebelumnya.
export function sisaRetur(
  sumber: Record<string, number>,
  sudahRetur: Record<string, number>,
): Record<string, number> {
  const sisa: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(sumber)) {
    const rem = qty - (sudahRetur[itemId] ?? 0);
    if (rem > 0) sisa[itemId] = rem;
  }
  return sisa;
}

// Total nilai retur = Σ qty × harga.
export function totalRetur(rows: { qty: number; harga: number }[]): number {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
}

// ── Refund harus sebanding dengan yang BENAR-BENAR dibayar ─────────────────
//
// Struk POS bisa kena promo, diskon golongan, voucher, dan poin. Kalau refund
// memakai harga daftar, pelanggan yang belanja banyak pakai diskon lalu meretur
// semuanya akan menerima uang LEBIH BANYAK daripada yang ia keluarkan.
//
// Rasio dihitung dari total dibayar ÷ nilai kotor struk, lalu dipakai ke tiap
// baris. Sederhana, dan tidak pernah mengembalikan lebih dari yang masuk.
export function rasioBayar(subtotalKotor: number, totalDibayar: number): number {
  const kotor = Number(subtotalKotor);
  const bayar = Number(totalDibayar);
  if (!Number.isFinite(kotor) || kotor <= 0) return 1;
  if (!Number.isFinite(bayar) || bayar < 0) return 1;
  // Rasio > 1 tidak masuk akal (bayar lebih besar dari harga daftar) — jangan
  // sampai refund justru membengkak karena data aneh.
  return Math.min(1, bayar / kotor);
}

export function hargaRefund(hargaSatuan: number, rasio: number): number {
  const h = Number(hargaSatuan);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.round(h * rasio);
}

// Modal per satuan barang yang diretur. Pakai HPP yang tercatat saat barang itu
// TERJUAL (sale_items.hpp, migrasi 0084) supaya nilai persediaan yang masuk
// kembali sama persis dengan yang keluar.
//
// Struk lama belum punya kolom itu → jatuh ke harga beli master, perilaku lama.
export function modalPerSatuan(
  hppBaris: number | null | undefined,
  qtyBaris: number,
  buyPriceMaster: number,
): number {
  const hpp = Number(hppBaris);
  const qty = Number(qtyBaris);
  if (Number.isFinite(hpp) && hpp > 0 && Number.isFinite(qty) && qty > 0) return hpp / qty;
  return Number(buyPriceMaster) || 0;
}
