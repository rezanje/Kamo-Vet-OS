// Pembagian potongan tingkat dokumen ke baris-barisnya.
//
// Potongan kepala dokumen (voucher, poin, diskon golongan, diskon manual kasir,
// diskon kepala tagihan klinik) tidak tersimpan per baris. Selisih antara jumlah
// nilai baris dan total dokumen dibagi proporsional terhadap nilai kotor tiap baris.
//
// Rumusnya sengaja dipakai bersama oleh laporan Komisi (`komisi-data.ts`) dan
// laporan Penjualan per Tenaga Penjual: dua layar yang membicarakan omzet orang
// yang sama tidak boleh menunjuk angka berbeda.

/**
 * Nilai neto tiap baris setelah potongan kepala dokumen dibagi proporsional.
 *
 * Dokumen yang totalnya lebih besar dari jumlah barisnya (mis. pajak atau biaya
 * yang hanya ada di kepala dokumen) TIDAK menaikkan nilai baris — yang dibagi
 * hanya potongan. Sisa selisihnya dilaporkan terpisah lewat `selisihKepalaDokumen`.
 */
export function alokasiPotonganDokumen(kotorPerBaris: readonly number[], totalDokumen: number): number[] {
  const jumlahBaris = kotorPerBaris.reduce((jumlah, nilai) => jumlah + nilai, 0);
  const potongan = Math.max(0, jumlahBaris - totalDokumen);
  return kotorPerBaris.map((kotor) => (jumlahBaris > 0 ? kotor - (potongan * kotor) / jumlahBaris : kotor));
}

/**
 * Bagian total dokumen yang tidak pernah sampai ke baris mana pun — nol untuk
 * dokumen biasa. Laporan memakai angka ini untuk membuktikan jumlah baris per
 * orang benar-benar menutup total dokumennya, bukan menyembunyikan selisih.
 */
export function selisihKepalaDokumen(kotorPerBaris: readonly number[], totalDokumen: number): number {
  const jumlahBaris = kotorPerBaris.reduce((jumlah, nilai) => jumlah + nilai, 0);
  return Math.max(0, totalDokumen - jumlahBaris);
}
