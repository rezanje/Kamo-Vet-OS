import { batasBeratWajar } from "./anabul";

/** Catatan di bawah kolom Berat saat mengoreksi rekam medis (satu baris, tampil di layar). */
export const CATATAN_KOREKSI_BERAT =
  "Berat profil anabul ikut berubah hanya jika ini catatan berat terbaru anabul ini; koreksi rekam lama tidak menimpa berat profil.";

/**
 * Batas atas isian Berat di layar koreksi. Berat tersimpan yang SUDAH melewati batas wajar (data lama)
 * tidak boleh membuat form gagal dikirim saat catatan lain dikoreksi; database tetap menolak bila nilai
 * yang diubah melewati batas spesies.
 */
export function batasBeratKoreksi(spesies: string | null | undefined, tersimpan: number | null | undefined): number | undefined {
  const batas = batasBeratWajar(spesies);
  if (batas === null) return undefined;
  return tersimpan != null && tersimpan > batas ? undefined : batas;
}

/** Berat dari form koreksi: null bila kolom tidak ada (klien lama), "kosong" bila ada tapi tanpa isi. */
export function bacaBeratKoreksi(mentah: FormDataEntryValue | null): { ada: boolean; nilai: number | null; valid: boolean } {
  if (mentah === null) return { ada: false, nilai: null, valid: true };
  const teks = String(mentah).trim();
  if (teks === "") return { ada: true, nilai: null, valid: true };
  const nilai = Number(teks);
  const valid = Number.isFinite(nilai) && nilai > 0 && nilai < 10000 && Math.round(nilai * 100) / 100 === nilai;
  return { ada: true, nilai, valid };
}
