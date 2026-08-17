// Kadaluarsa bertingkat & urutan keluar barang (permintaan Pak Faisal, meeting
// 14 Agustus). Murni — dites di __tests__/kadaluarsa-batch.test.ts.
//
// Dipisah dari lib/kadaluarsa.ts yang mengurus STATUS (warna & ambang hari) di
// layar Monitor Expired; di sini urusannya jumlah per tanggal saat barang masuk,
// dan lapisan mana yang keluar duluan saat barang terjual.

export type BatchInput = { qty: number | string; exp_date?: string | null };
export type Batch = { qty: number; expDate: string | null };

const TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rapikan isian tanggal-per-jumlah jadi daftar lapisan yang akan dibuat.
 *
 * Satu kiriman obat sering berisi dus dengan masa simpan berbeda. Sebelum ini
 * penerimaan hanya menyimpan SATU tanggal per baris, jadi 10 botol yang datang
 * dengan dua tanggal tercatat seolah kadaluarsa semuanya di tanggal yang sama.
 *
 * Aturannya:
 * - jumlah yang diisi tidak boleh melebihi qty yang benar-benar diterima;
 * - baris tanpa tanggal sah ikut jadi lapisan tanpa tanggal;
 * - sisa qty yang tidak dijatah tetap masuk sebagai lapisan tanpa tanggal, jadi
 *   stok yang bertambah selalu sama dengan yang diterima — salah ketik di layar
 *   tidak boleh sampai mengubah jumlah stok.
 */
export function normalisasiBatch(qtyTerima: number, input: BatchInput[]): Batch[] {
  const total = Math.max(0, Number(qtyTerima) || 0);
  if (total <= 0) return [];

  const perTanggal = new Map<string, number>();
  let terpakai = 0;

  for (const b of input) {
    const qty = Math.max(0, Number(b.qty) || 0);
    if (qty <= 0) continue;
    const tgl = String(b.exp_date ?? "").trim();
    if (!TANGGAL.test(tgl)) continue;          // tanpa tanggal → ikut sisa di bawah
    const boleh = Math.min(qty, total - terpakai);
    if (boleh <= 0) break;
    perTanggal.set(tgl, (perTanggal.get(tgl) ?? 0) + boleh);
    terpakai += boleh;
  }

  const batches: Batch[] = [...perTanggal.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([expDate, qty]) => ({ qty, expDate }));

  const sisa = total - terpakai;
  if (sisa > 0) batches.push({ qty: sisa, expDate: null });
  return batches;
}

/** Jumlah yang belum dijatah tanggal — dipakai layar untuk memberi tahu petugas. */
export function sisaBelumDijatah(qtyTerima: number, input: BatchInput[]): number {
  const total = Math.max(0, Number(qtyTerima) || 0);
  const dijatah = input.reduce((a, b) => {
    const tgl = String(b.exp_date ?? "").trim();
    return TANGGAL.test(tgl) ? a + Math.max(0, Number(b.qty) || 0) : a;
  }, 0);
  return Math.max(0, total - Math.min(total, dijatah));
}

export type LapisanFefo = { exp_date?: string | null; tanggal?: string | null; created_at?: string | null };

/**
 * Urutan pengambilan stok: yang paling dekat kadaluarsa lebih dulu (FEFO),
 * baru yang paling lama masuk (FIFO).
 *
 * Lapisan TANPA tanggal kadaluarsa ditaruh belakangan supaya barang bertanggal
 * benar-benar keluar duluan; kalau ditaruh depan, barang yang mau kedaluwarsa
 * malah mengendap di gudang sampai basi.
 */
export function urutFefo<T extends LapisanFefo>(layers: T[]): T[] {
  return [...layers].sort((a, b) => {
    const ea = a.exp_date ?? "";
    const eb = b.exp_date ?? "";
    if (ea && eb && ea !== eb) return ea.localeCompare(eb);
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    const ta = a.tanggal ?? "";
    const tb = b.tanggal ?? "";
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
}
