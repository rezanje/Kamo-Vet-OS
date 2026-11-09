import type { PotonganBaris } from "./promo-hitung";

// Rincian "Promo otomatis" di layar kasir klinik (Andri 9 Nov 2026): kasir perlu
// tahu promo apa yang memotong dan barang mana yang kena, bukan hanya angkanya.
// Hanya untuk tampilan — angka uang tetap dari hitungPromoKeranjang/server.

export type RincianPromoLayar = { promoId: string; nama: string; barang: string[]; potongan: number };

export function rincianPromoLayar(
  hasil: PotonganBaris[],
  baris: { item_id?: string | null; deskripsi: string }[],
): RincianPromoLayar[] {
  const namaBarang = new Map<string, string>();
  for (const b of baris) {
    if (b.item_id && !namaBarang.has(b.item_id)) namaBarang.set(b.item_id, b.deskripsi.trim());
  }
  const perPromo = new Map<string, RincianPromoLayar>();
  for (const h of hasil) {
    if (!(h.potongan > 0)) continue;
    const r = perPromo.get(h.promoId) ?? { promoId: h.promoId, nama: h.promoName, barang: [], potongan: 0 };
    r.potongan += h.potongan;
    const nama = namaBarang.get(h.item_id);
    if (nama && !r.barang.includes(nama)) r.barang.push(nama);
    perPromo.set(h.promoId, r);
  }
  return [...perPromo.values()];
}
