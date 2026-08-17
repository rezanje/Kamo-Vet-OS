// Harga jual bertingkat menurut jumlah beli (migrasi 0120) — murni, dites di
// __tests__/harga-tingkat.test.ts.
//
// Aturan mainnya sengaja sesederhana Accurate: daftar "beli minimal sekian →
// harga sekian". Yang dipakai adalah tingkat TERTINGGI yang jumlah belinya sudah
// tercapai. Tidak ada tingkat yang cocok = harga normal.

export type Tingkat = { min_qty: number; harga: number };

/** Urut naik & buang baris ngawur — dipakai layar maupun server. */
export function rapikanTingkat(rows: Tingkat[]): Tingkat[] {
  return rows
    .map((t) => ({ min_qty: Number(t.min_qty) || 0, harga: Math.max(0, Number(t.harga) || 0) }))
    .filter((t) => t.min_qty > 0)
    .sort((a, b) => a.min_qty - b.min_qty);
}

/**
 * Harga satuan untuk qty tertentu.
 *
 * qty dihitung dalam SATUAN DASAR: beli 2 dus isi 12 sama dengan 24 pcs, jadi
 * tingkat "minimal 20" ikut berlaku — kalau tidak, pembeli yang beli per dus
 * malah tidak pernah dapat harga grosir.
 */
export function hargaTingkat(qtyDasar: number, tiers: Tingkat[], hargaNormal: number): number {
  const qty = Number(qtyDasar) || 0;
  const normal = Math.max(0, Number(hargaNormal) || 0);
  let harga = normal;
  for (const t of rapikanTingkat(tiers)) {
    if (qty >= t.min_qty) harga = t.harga;
  }
  return harga;
}

/** Tingkat berikutnya yang belum tercapai — dipakai layar kasir untuk menawarkan. */
export function tingkatBerikutnya(qtyDasar: number, tiers: Tingkat[]): Tingkat | null {
  const qty = Number(qtyDasar) || 0;
  return rapikanTingkat(tiers).find((t) => qty < t.min_qty) ?? null;
}
