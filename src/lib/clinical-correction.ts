import type { ServicePerformersSnapshot } from "./service-performers";
import type { BmhpInput } from "./procedure-bmhp";
import type { WithdrawnItem } from "./tarik-item";
export type ClinicalCorrection = {
  fullEdit?: boolean;
  recordId: string; revision: number;
  anamnesis: string | null; diagnosis: string | null; therapy: string | null;
  suhu: number | null; berat: number | null; gejala_klinis: string | null; hasil_penunjang: string | null;
  penunjang_urls: string[] | null; follow_up: string | null; catatan_resep: string | null;
  prescriptions: { id?: string; item_id?: string | null; harga?: number; faktor?: number; jenis?: string; kategori?: string | null; compound_recipe_id?: string | null; bmhp_components?: (BmhpInput & { name?: string })[] | null; nama_obat: string; qty: number; satuan?: string | null; aturan_pakai: string | null; service_performers?: ServicePerformersSnapshot | null;
    /** Asal paket (Grup) baris isi — wajib dibawa saat koreksi supaya paket tidak terlepas jadi baris biasa. */
    package_item_id?: string | null; package_qty?: number | string | null;
    package?: { name: string | null } | { name: string | null }[] | null }[];
  compounds?: { id: string; recipe_name: string; status: string }[];
  /** Baris yang sudah ditarik dari rekam medis (tidak ikut keranjang/tagihan). */
  withdrawn?: WithdrawnItem[];
};

/** Asal paket baris resep tersimpan → isian paket keranjang rekam medis (koreksi). Anisa 7 Nov:
 * tanpa ini koreksi rekam medis menyimpan ulang isi paket sebagai baris biasa, dan tagihan
 * menampilkan isinya berceceran. Baris tanpa asal paket (atau racikan) tetap baris biasa. */
export function savedPackageOrigin(row: ClinicalCorrection["prescriptions"][number]): { paket_id?: string; paket_nama?: string; paket_qty?: number } {
  const jumlah = Number(row.package_qty);
  if (!row.package_item_id || row.compound_recipe_id || !Number.isSafeInteger(jumlah) || jumlah <= 0) return {};
  const relasi = Array.isArray(row.package) ? row.package[0] ?? null : row.package ?? null;
  return { paket_id: row.package_item_id, paket_nama: relasi?.name?.trim() || row.nama_obat, paket_qty: jumlah };
}
