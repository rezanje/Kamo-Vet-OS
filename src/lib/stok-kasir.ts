// Kasir petshop: barang yang stoknya tidak cukup tidak boleh dibayar (10 Nov 2026).
// Layar memakai angka stok saat barang dimasukkan ke keranjang, jadi ini hanya penahan awal;
// penentu akhirnya database (`sale_stock_assert_available`) yang membaca saldo terkini.
import type { BarisKurangStok } from "./stok-kurang";

export type BarisKeranjangStok = {
  item_id?: string | null;
  item_type?: string | null;
  nama: string;
  qty: number;
  faktor?: number | null;
  /** Stok dalam satuan dasar (Grup: jumlah paket yang masih bisa dirakit). null = tidak dilacak. */
  stok?: number | null;
};

/**
 * Baris keranjang yang jumlahnya melebihi stok. Barang yang sama di beberapa baris
 * (mis. satuan pcs dan dus) dijumlahkan dulu dalam satuan dasar, jadi dua baris @3
 * tidak lolos berdua terhadap stok 5. Jasa dan Non-Persediaan tidak punya stok.
 */
export function stokKurangKasir(cart: BarisKeranjangStok[]): BarisKurangStok[] {
  const butuh = new Map<string, { nama: string; qty: number; stok: number }>();
  for (const l of cart) {
    if (!l.item_id || (l.item_type !== "Persediaan" && l.item_type !== "Grup")) continue;
    if (l.stok == null) continue;
    const stok = Number(l.stok);
    const qty = Number(l.qty) * (Number(l.faktor) || 1);
    if (!Number.isFinite(stok) || !Number.isFinite(qty) || qty <= 0) continue;
    const prev = butuh.get(l.item_id);
    butuh.set(l.item_id, { nama: prev?.nama ?? l.nama, qty: (prev?.qty ?? 0) + qty, stok });
  }
  const kurang: BarisKurangStok[] = [];
  for (const [id, b] of butuh) {
    if (b.qty > b.stok) kurang.push({ kunci: id, item_id: id, nama: b.nama, butuh: b.qty, tersedia: Math.max(0, b.stok) });
  }
  return kurang;
}
