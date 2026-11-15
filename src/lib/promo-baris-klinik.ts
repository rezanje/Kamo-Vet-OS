// Potongan PROMO per baris tagihan klinik (lantai harga P03, 11 Nov 2026).
//
// Kasus: kode kampanye GROOM11 (50% hanya untuk jasa grooming) pada nota Grooming 1 x Rp90.000 + Anthel Cat 1 x Rp18.000.
// Mesin promo (hitungPotonganKlinik) memotong benar hanya Grooming (Rp45.000) dan satu angka diskon invoice (Rp45.000) dikirim ke
// database. Penjaga lantai harga di database membagi seluruh diskon invoice rata ke semua baris obat, jadi Anthel dinilai Rp10.500
// dan ditolak. Agar penjaga tahu potongan promo itu milik baris mana, aplikasi menyertakan "promo_discount" di tiap baris yang
// memang kena promo. Uang tidak berubah: invoices.discount tetap satu-satunya angka diskon yang dibukukan (promo ikut di dalamnya);
// angka per baris hanya dibaca penjaga lantai.
//
// Aturan yang dijaga database (migrasi 20261111140000): tiap angka >= 0, paling banyak 2 desimal, tidak melebihi nilai barisnya,
// dan jumlahnya tidak melebihi diskon invoice. Modul ini menghitungnya dengan bilangan bulat sen (BigInt) supaya tidak pernah
// satu sen lebih besar dari hitungan database.

import type { RincianPromoKlinik } from "./tagihan-klinik";

// Target ES2017: literal BigInt (mis. 0n) tidak tersedia, jadi konstanta dibuat lewat BigInt().
const NOL = BigInt(0), SATU = BigInt(1), LIMA_RIBU = BigInt(5000), SEPULUH_RIBU = BigInt(10000);

export type BarisUntukPromo = { item_id?: string | null; qty: number; harga: number; diskon_persen?: number | null };

/** Sen, pembulatan setengah-naik seperti round(numeric, 2) di database; harga & persen dibulatkan 2 desimal seperti kolom RPC. */
function nilaiBarisSen(l: BarisUntukPromo): bigint {
  const qty = BigInt(Math.max(0, Math.round(Number(l.qty) || 0)));
  const hargaSen = BigInt(Math.max(0, Math.round((Number(l.harga) || 0) * 100)));
  const persenSeperseratus = BigInt(Math.min(10000, Math.max(0, Math.round((Number(l.diskon_persen) || 0) * 100))));
  // qty x harga x (1 - persen/100) dalam sen = qty * hargaSen * (10000 - p) / 10000, dibulatkan setengah-naik.
  return (qty * hargaSen * (SEPULUH_RIBU - persenSeperseratus) + LIMA_RIBU) / SEPULUH_RIBU;
}

/**
 * Bagi potongan promo per barang (rincianPromo dari hitungPotonganKlinik) ke baris-baris yang memuat barang itu, sebanding nilai baris.
 * Hasil sejajar dengan `rows` (rupiah, paling banyak 2 desimal). Selalu aman untuk database:
 *  - tiap baris <= nilai barisnya (kelebihan tidak dibebankan ke baris mana pun; tetap diskon transaksi biasa),
 *  - jumlah seluruh baris <= `diskonInvoice` (bila lebih, baris terbesar dikurangi dulu),
 *  - tanpa rincian / tanpa baris yang cocok = semua 0 (perilaku lama: seluruh diskon dibagi rata oleh database).
 */
export function alokasiPromoPerBaris(
  rows: readonly BarisUntukPromo[],
  rincian: readonly Pick<RincianPromoKlinik, "item_id" | "potongan">[] | undefined,
  diskonInvoice: number,
): number[] {
  const hasil: bigint[] = rows.map(() => NOL);
  const batas = BigInt(Math.max(0, Math.round((Number(diskonInvoice) || 0) * 100)));
  if (!rincian?.length || batas <= NOL) return hasil.map(() => 0);

  const perBarang = new Map<string, bigint>();
  for (const r of rincian) {
    const sen = BigInt(Math.max(0, Math.round((Number(r.potongan) || 0) * 100)));
    if (!r.item_id || sen <= NOL) continue;
    perBarang.set(r.item_id, (perBarang.get(r.item_id) ?? NOL) + sen);
  }
  const nilai = rows.map(nilaiBarisSen);

  for (const [itemId, potongan] of perBarang) {
    const idx = rows.map((l, i) => ({ l, i })).filter(({ l, i }) => l.item_id === itemId && nilai[i] > NOL).map(({ i }) => i);
    const jumlahNilai = idx.reduce((a, i) => a + nilai[i], NOL);
    if (!idx.length || jumlahNilai <= NOL) continue;
    const total = potongan < jumlahNilai ? potongan : jumlahNilai;
    // porsi sebanding nilai baris (dibulatkan ke bawah), sisa sen ke baris bernilai terbesar
    const bagian = idx.map((i) => (total * nilai[i]) / jumlahNilai);
    let sisa = total - bagian.reduce((a, b) => a + b, NOL);
    const urut = [...idx.keys()].sort((a, b) => (nilai[idx[b]] > nilai[idx[a]] ? 1 : nilai[idx[b]] < nilai[idx[a]] ? -1 : a - b));
    for (let k = 0; sisa > NOL && k < urut.length * 2; k++) {
      const j = urut[k % urut.length];
      const ruang = nilai[idx[j]] - bagian[j];
      if (ruang <= NOL) continue;
      bagian[j] += SATU; sisa -= SATU;
    }
    idx.forEach((i, j) => { hasil[i] += bagian[j]; });
  }

  // jumlah seluruh baris tidak boleh melebihi diskon invoice
  let jumlah = hasil.reduce((a, b) => a + b, NOL);
  if (jumlah > batas) {
    const urut = [...hasil.keys()].sort((a, b) => (hasil[b] > hasil[a] ? 1 : hasil[b] < hasil[a] ? -1 : a - b));
    for (const i of urut) {
      if (jumlah <= batas) break;
      const kurang = jumlah - batas < hasil[i] ? jumlah - batas : hasil[i];
      hasil[i] -= kurang; jumlah -= kurang;
    }
  }
  return hasil.map((sen) => Number(sen) / 100);
}
