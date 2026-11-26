// Peringatan jumlah hitung fisik yang tidak masuk akal (insiden OPR.00009 Surken: TH4 Disinfektan satuan 1L
// diketik 1000 padahal maksudnya 1; Shampoo Grooming 3in1 20L satuan 500ML diketik 3000 padahal 0).
// Aturan murni ini dipakai server (layar hitung yang tidak boleh melihat stok sistem) dan layar yang stok
// sistemnya memang tampil (opname inventaris operasional). Hanya peringatan: tidak mengubah apa pun yang disimpan.

/** Fisik lebih dari ini x stok sistem (stok sistem > 0) dianggap janggal. */
export const BATAS_KALI_SISTEM = 10;
/** Fisik sebesar ini atau lebih dianggap janggal bila stok sistem di bawah BATAS_SISTEM_KECIL. */
export const BATAS_FISIK_BESAR = 1000;
export const BATAS_SISTEM_KECIL = 100;

export function jumlahTakWajar(fisik: number, sistem: number): boolean {
  if (!Number.isFinite(fisik) || !Number.isFinite(sistem)) return false;
  if (sistem > 0 && fisik > BATAS_KALI_SISTEM * sistem) return true;
  return fisik >= BATAS_FISIK_BESAR && sistem < BATAS_SISTEM_KECIL;
}

/** 1000 -> "1.000", 0.5 -> "0,5" (format Indonesia). */
export function fmtJumlah(n: number): string {
  return (Number(n) || 0).toLocaleString("id-ID", { maximumFractionDigits: 4 });
}

export type SatuanTurunan = { unit: string; factor: number };

/**
 * Isi kemasan dari tabel item_units (factor = isi 1 satuan itu dalam satuan dasar items.unit).
 * "1 btl = 500 ML". null bila barang tidak punya satuan lain (tidak ada data = tidak ditampilkan).
 */
export function teksKemasan(dasar: string, turunan: SatuanTurunan[] | null | undefined, maks = 3): string | null {
  const base = dasar.trim();
  const baris = (turunan ?? [])
    .filter((u) => u.unit?.trim() && u.unit.trim() !== base && Number.isFinite(Number(u.factor)) && Number(u.factor) > 0)
    .sort((a, b) => Number(a.factor) - Number(b.factor))
    .slice(0, maks)
    .map((u) => `1 ${u.unit.trim()} = ${fmtJumlah(Number(u.factor))} ${base || "satuan dasar"}`);
  return baris.length ? baris.join(" · ") : null;
}
