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

/** Karakter yang TIDAK dihitung sebagai isi alasan: spasi, tanda baca, simbol ASCII, kontrol, dan karakter tak terlihat
 * (zero-width, BOM, variation selector, filler Hangul). Sejajar dengan database (clinic_withdraw_record_items) tetapi tidak identik
 * untuk karakter Unicode langka (tanda gabung, huruf atas, dll.): layar bisa meloloskan alasan yang lalu ditolak database (pesannya
 * ditampilkan) atau sebaliknya. Keduanya aman (gagal tertutup); database yang berwenang. */
const TIDAK_BERISI = /[\p{P}\p{S}\p{Z}\p{C}\s\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180b-\u180e\u3164\ufe00-\ufe0f\uffa0]/gu;
const panjang = (text: string): number => [...text].length;
/** Jumlah huruf/angka bermakna dalam alasan. */
export const isiAlasanTarik = (reason: string): number => panjang(reason.replace(TIDAK_BERISI, ""));

/** 5-200 karakter (code point, seperti database) DAN minimal 5 karakter bermakna: "....." atau zero-width tidak lolos. */
export const alasanTarikValid = (reason: string): boolean => {
  const trimmed = reason.trim();
  const n = panjang(trimmed);
  return n >= ALASAN_TARIK_MIN && n <= ALASAN_TARIK_MAX && isiAlasanTarik(trimmed) >= ALASAN_TARIK_MIN;
};

/** Penarikan akan menghabiskan SEMUA baris di form (baris baru yang belum disimpan dihitung sebagai sisa): tagihan baru bisa
 * terbit lagi setelah ada item. Hanya untuk peringatan; database tidak melarang. */
export const tarikMenghabiskan = (cart: readonly TarikBaris[], ids: readonly string[]): boolean =>
  cart.length > 0 && cart.every(row => !!row.prescription_item_id && ids.includes(row.prescription_item_id));

/** Sama dengan gerbang database: hanya OWNER atau DOCTOR aktif (akses klinik cabang diperiksa terpisah lewat RPC). */
export const peranBolehTarik = (profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean =>
  !!profile && profile.is_active === true && (profile.role === "OWNER" || profile.role === "DOCTOR");
export const PESAN_PERAN_TARIK = "Hanya pemilik atau dokter yang boleh menarik item dari rekam medis.";
export const PESAN_AKSES_TARIK = "Anda tidak memiliki akses klinik ke kunjungan ini. Tidak ada yang ditarik.";

/** Pesan database -> teks pengguna (kode di depan dibuang; pesan sudah berbahasa Indonesia). */
export function pesanTarikGagal(message: string | null | undefined): string {
  const text = String(message ?? "").trim();
  if (!text) return "Penarikan belum terkonfirmasi. Muat ulang halaman sebelum mencoba lagi.";
  if (text.startsWith("IDEMPOTENCY_CONFLICT")) return "Permintaan sebelumnya dengan isi berbeda sudah tercatat. Muat ulang halaman rekam medis.";
  return text.replace(/^(ACCESS_DENIED|WITHDRAW_[A-Z]+|RECORD_POSTED|RECORD_INVALID|COMPOUND_LOCKED|PACKAGE_PARTIAL|PACKAGE_INVALID):\s*/, "");
}
