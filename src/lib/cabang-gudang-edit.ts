// Aturan bersama layar Perusahaan > Cabang / Gudang untuk ubah, nonaktifkan, dan hapus.
// Penjaga yang sebenarnya ada di fungsi database (update_branch_info, update_warehouse_info, delete_warehouse);
// berkas ini hanya untuk pesan ramah, validasi awal, dan keputusan tampilan.

export const NAMA_CABANG_MAX = 80;
export const NAMA_GUDANG_MAX = 100;
export const ALASAN_MIN = 5;
export const ALASAN_MAX = 300;
export const ALASAN_HAPUS_DIPAKAI = "Sudah dipakai, nonaktifkan saja";
export const ALASAN_HAPUS_OWNER = "Hanya OWNER yang bisa menghapus gudang";

/** Pakai nama tanpa spasi di tepi dan tanpa spasi ganda, sama seperti yang disimpan database. */
export function rapikanNama(raw: unknown): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

const punyaKarakterKontrol = (text: string) => /[\u0000-\u001f\u007f-\u009f]/.test(text);

function validasiNama(raw: unknown, label: string, max: number): string | null {
  const nama = rapikanNama(raw);
  if (!nama) return `Nama ${label} wajib diisi`;
  if (nama.length < 2 || nama.length > max || punyaKarakterKontrol(nama)) return `Nama ${label} 2 sampai ${max} karakter`;
  return null;
}
export const validasiNamaCabang = (raw: unknown) => validasiNama(raw, "cabang", NAMA_CABANG_MAX);
export const validasiNamaGudang = (raw: unknown) => validasiNama(raw, "gudang", NAMA_GUDANG_MAX);

/** Nama sama dengan nama lain tanpa membedakan huruf besar/kecil dan spasi ganda. */
export function namaKembar(nama: unknown, lainnya: readonly string[]): boolean {
  const kunci = rapikanNama(nama).toLowerCase();
  return !!kunci && lainnya.some(lain => rapikanNama(lain).toLowerCase() === kunci);
}

export function validasiAlasanHapus(raw: unknown): string | null {
  const alasan = String(raw ?? "").trim();
  if (alasan.length < ALASAN_MIN || alasan.length > ALASAN_MAX) return `Alasan hapus wajib diisi (${ALASAN_MIN} sampai ${ALASAN_MAX} karakter)`;
  return null;
}

export type PetaPemakaian = Record<string, string[]>;

/** Peta pemakaian dari database; bentuk tak dikenal = tidak diketahui (null). */
export function bacaPetaPemakaian(data: unknown): PetaPemakaian | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const hasil: PetaPemakaian = {};
  for (const [id, tabel] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(tabel)) return null;
    hasil[id] = tabel.map(String);
  }
  return hasil;
}

/** Kode cabang terkunci bila sudah ada transaksi; bila pemakaian tidak terbaca, kunci (gagal aman). */
export const kodeCabangTerkunci = (peta: PetaPemakaian | null, id: string) => peta === null || (peta[id]?.length ?? 0) > 0;
export const gudangDipakai = (peta: PetaPemakaian | null, id: string) => peta === null || (peta[id]?.length ?? 0) > 0;

export type KeputusanHapus = { boleh: boolean; alasan: string | null };
export function keputusanHapusGudang(role: string | null | undefined, dipakai: boolean): KeputusanHapus {
  if (role !== "OWNER") return { boleh: false, alasan: ALASAN_HAPUS_OWNER };
  if (dipakai) return { boleh: false, alasan: ALASAN_HAPUS_DIPAKAI };
  return { boleh: true, alasan: null };
}

/** SQLSTATE yang dilempar fungsi database dengan pesan Indonesia yang aman ditampilkan. */
const KODE_AMAN = new Set(["42501", "22023", "23505", "CG001", "CG002"]);
export const PESAN_UMUM = "Perubahan belum dapat disimpan. Muat ulang halaman, periksa hasilnya, lalu coba lagi.";
export function pesanGalat(error: unknown): string {
  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code === "string" && KODE_AMAN.has(code) && typeof message === "string" && message.trim()) return message.trim();
  }
  return PESAN_UMUM;
}
