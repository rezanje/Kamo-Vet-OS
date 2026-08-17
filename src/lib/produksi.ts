// Produksi own brand (migrasi 0122) — logika murni, dites di __tests__/produksi.test.ts.
//
// Bedanya dengan racik obat klinik: racikan memotong stok saat transaksi dan tidak
// punya tahap. Own brand punya tahap — bahan keluar duluan, barang jadi masuk
// belakangan — dan harga pokoknya lahir dari bahan yang benar-benar terpakai,
// bukan dari harga master.

export type BahanResep = { item_id: string; nama?: string; qty: number };

/**
 * Kebutuhan bahan untuk sekian batch.
 *
 * Resep ditulis "sekian bahan untuk sekian barang jadi"; batch adalah kelipatan
 * resep. Dipisahkan ke sini supaya layar (yang memperlihatkan kebutuhan sebelum
 * tombol ditekan) dan server (yang benar-benar memotong stok) memakai rumus yang
 * sama — beda rumus di dua tempat itulah yang bikin stok tidak pernah cocok.
 */
export function kebutuhanBahan(bahan: BahanResep[], batch: number): BahanResep[] {
  const b = Number(batch) || 0;
  if (b <= 0) return [];
  return bahan
    .map((x) => ({ ...x, qty: (Number(x.qty) || 0) * b }))
    .filter((x) => x.qty > 0);
}

/** Jumlah barang jadi yang direncanakan: output resep × batch. */
export function rencanaJadi(outputQty: number, batch: number): number {
  const o = Number(outputQty) || 0;
  const b = Number(batch) || 0;
  return o > 0 && b > 0 ? o * b : 0;
}

/**
 * Harga pokok per unit barang jadi.
 *
 * Pembaginya qty yang BENAR-BENAR jadi, bukan rencana: kalau produksi 100 tapi
 * yang jadi 95, modal 100 unit menempel di 95 unit — itu memang yang terjadi.
 * Qty jadi nol berarti gagal total; modalnya tidak boleh dibagi nol.
 */
export function hppPerUnit(nilaiBahan: number, qtyJadi: number): number {
  const nilai = Number(nilaiBahan) || 0;
  const qty = Number(qtyJadi) || 0;
  if (qty <= 0 || nilai <= 0) return 0;
  return nilai / qty;
}

/** Bahan yang stoknya kurang untuk batch ini — dipakai layar & server sebelum mulai. */
export function bahanKurang(
  kebutuhan: BahanResep[],
  stok: Map<string, number>,
): { item_id: string; nama?: string; butuh: number; ada: number }[] {
  return kebutuhan
    .map((k) => ({ item_id: k.item_id, nama: k.nama, butuh: k.qty, ada: Number(stok.get(k.item_id) ?? 0) }))
    .filter((k) => k.ada < k.butuh);
}
