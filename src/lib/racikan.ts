// Bahan baku racikan (BOM line). harga = sell_price snapshot per satuan.
export type RacikanIngredient = {
  item_id: string;
  nama: string;
  qty: number;    // dosis
  satuan: string;
  harga: number;  // sell_price per satuan
};

const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

// Total racikan = Σ(harga × dosis). Tanpa jasa/markup (spec §3).
export function racikanTotal(ings: RacikanIngredient[]): number {
  return ings.reduce((a, i) => a + safe(i.harga) * safe(i.qty), 0);
}

/** Kenapa racikan belum bisa disimpan, dalam kalimat yang siap ditampilkan ke dokter.
 * String kosong berarti racikan sudah lengkap. Dipakai form pemeriksaan maupun halaman
 * detail rekam medis supaya tombol simpan yang mati selalu menjelaskan dirinya. */
export function alasanRacikanBelumLengkap({ skuDipilih, resepResmiDipilih, resepResmiTerisi, adaResepResmi, bolehManual, bahan }: {
  skuDipilih: boolean;
  /** Resep resmi yang dipilih memang terdaftar aktif untuk SKU ini. */
  resepResmiDipilih: boolean;
  /** Draf masih menyimpan pilihan resep resmi (mungkin sudah tidak berlaku). */
  resepResmiTerisi: boolean;
  adaResepResmi: boolean;
  bolehManual: boolean;
  bahan: readonly RacikanIngredient[];
}): string {
  if (!skuDipilih) return "Pilih obat racik dulu.";
  if (resepResmiDipilih) return "";
  if (resepResmiTerisi) return "Resep resmi yang dipilih sudah tidak berlaku. Pilih ulang komposisi racikan.";
  if (!bolehManual) {
    return adaResepResmi ? "Pilih resep resmi dulu." : "Resep resmi belum ada — minta Owner/Admin aktifkan racikan khusus.";
  }
  if (!bahan.length) return "Tambah minimal satu bahan racikan.";
  if (!bahan.every(row => Number.isFinite(row.qty) && row.qty > 0)) return "Isi jumlah tiap bahan racikan lebih dari 0.";
  return "";
}
