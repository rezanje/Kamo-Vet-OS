// Diskon golongan pelanggan (customer_categories.diskon_persen), migrasi 0066.
// Dipakai KLIEN untuk menampilkan dan SERVER sebagai satu-satunya sumber angka
// yang disimpan — kasir tidak boleh bisa mengarang diskon golongan.
//
// Persen sengaja di-cap di sini, bukan hanya di constraint DB: data lama atau
// data yang masuk lewat jalur lain tidak boleh bikin total transaksi negatif.
export function diskonGolongan(subtotal: number, persen: number): number {
  const sub = Number(subtotal);
  const p = Number(persen);
  if (!Number.isFinite(sub) || sub <= 0) return 0;
  if (!Number.isFinite(p) || p <= 0) return 0;
  const capPersen = Math.min(p, 100);
  return Math.min(sub, Math.round((sub * capPersen) / 100));
}

// Poin yang didapat dari satu transaksi (customer_categories.rupiah_per_poin,
// migrasi 0078). Golongan tanpa pengaturan sendiri memakai 1000 = perilaku lama.
//
// Angkanya dibulatkan ke bawah: memberi poin untuk belanja yang belum genap
// membuat saldo poin tidak pernah cocok dengan riwayat belanjanya.
export const RUPIAH_PER_POIN_DEFAULT = 1000;

export function poinDidapat(total: number, rupiahPerPoin?: number | null): number {
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0) return 0;
  const per = Number(rupiahPerPoin);
  const rate = Number.isFinite(per) && per > 0 ? per : RUPIAH_PER_POIN_DEFAULT;
  return Math.floor(t / rate);
}
