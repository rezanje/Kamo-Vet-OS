/** "Tarik item": soft-withdraw of a SAVED, not-yet-billed row of an outpatient medical record (RPC
 * clinic_withdraw_record_items). Pure helpers shared by the Edit form and the server action. */
export type TarikBaris = { prescription_item_id?: string; package_item_id?: string | null; compound_recipe_id?: string | null; jenis?: string };
export type WithdrawnItem = {
  id: string; nama_obat: string; qty: number; satuan: string | null; jenis: string | null; package_name?: string | null;
  withdrawn_at: string; withdrawn_by_name: string | null; reason: string | null;
};
export const ALASAN_TARIK_MIN = 5;
export const ALASAN_TARIK_MAX = 200;

/** Racikan sudah diracik (stok bahan keluar): hanya lewat Aksi racikan, tidak pernah ditarik dari Edit. */
export const bisaDitarik = (row: TarikBaris): boolean => !!row.prescription_item_id && !row.compound_recipe_id && row.jenis !== "racikan";

/** Baris isi paket hanya ditarik utuh: kembalikan id SEMUA baris tersimpan dari paket yang sama. */
export function idTarik(cart: TarikBaris[], row: TarikBaris): string[] {
  if (!bisaDitarik(row)) return [];
  const sama = row.package_item_id ? cart.filter(r => r.package_item_id === row.package_item_id && bisaDitarik(r)) : [row];
  return [...new Set(sama.map(r => r.prescription_item_id!))].sort();
}

export const alasanTarikValid = (reason: string): boolean => {
  const n = reason.trim().length;
  return n >= ALASAN_TARIK_MIN && n <= ALASAN_TARIK_MAX;
};

/** Pesan database -> teks pengguna (kode di depan dibuang; pesan sudah berbahasa Indonesia). */
export function pesanTarikGagal(message: string | null | undefined): string {
  const text = String(message ?? "").trim();
  if (!text) return "Penarikan belum terkonfirmasi. Muat ulang halaman sebelum mencoba lagi.";
  if (text.startsWith("IDEMPOTENCY_CONFLICT")) return "Permintaan sebelumnya dengan isi berbeda sudah tercatat. Muat ulang halaman rekam medis.";
  return text.replace(/^(ACCESS_DENIED|WITHDRAW_[A-Z]+|RECORD_POSTED|RECORD_INVALID|COMPOUND_LOCKED|PACKAGE_PARTIAL|PACKAGE_INVALID):\s*/, "");
}
