// Label potongan per barang di struk & invoice (Reza 8 Nov 2026): promo dan diskon
// barang dicetak di bawah baris barangnya, bagian bawah struk khusus diskon transaksi.
// Satu tempat supaya struk petshop dan klinik menyebutnya dengan kata yang sama.

/** "Promo Icarae MBC". Nama yang sudah diawali "Promo" tidak diberi awalan dua kali. */
export function labelPromo(nama: string | null | undefined): string {
  const bersih = (nama ?? "").trim();
  if (!bersih) return "Promo";
  return /^promo\b/i.test(bersih) ? bersih : `Promo ${bersih}`;
}

/** Diskon yang diketik kasir di satu baris: persen bila diketahui, selain itu "Diskon item". */
export function labelDiskonManual(persen: number | null | undefined): string {
  const nilai = Number(persen);
  return persen != null && Number.isFinite(nilai) && nilai > 0 ? `Diskon ${nilai}%` : "Diskon item";
}
