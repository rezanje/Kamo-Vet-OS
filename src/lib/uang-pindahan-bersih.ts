/**
 * Uang pindahan dari tagihan lama (terbit ulang) yang MASIH menempel pada tagihan pengganti.
 *
 * Baris pindahan membawa `transferred_from`; ketika penerimaannya dibatalkan, pembaliknya adalah baris minus
 * dengan `reversal_of` ke baris pindahan itu dan TANPA `transferred_from`. Menjumlahkan hanya baris yang
 * ber-`transferred_from` membuat layar koreksi tetap menganggap uang itu ada (Kovu, INV-202611-1285: "Pembayaran
 * dialihkan Rp90.000" padahal sudah dibalik), lalu form mengirim status Lunas dan koreksi ditolak.
 */
export type BarisPembayaranPindahan = {
  id?: string | null;
  amount: number | string | null;
  transferred_from?: string | null;
  reversal_of?: string | null;
};

export function uangPindahanBersih(rows: readonly BarisPembayaranPindahan[]): number {
  const idPindahan = new Set(rows.filter((p) => p.transferred_from && p.id).map((p) => p.id as string));
  const neto = rows.reduce((sum, p) => {
    const dibalikDariPindahan = !!p.reversal_of && idPindahan.has(p.reversal_of);
    return p.transferred_from || dibalikDariPindahan ? sum + Number(p.amount ?? 0) : sum;
  }, 0);
  return Math.max(0, neto);
}
