// Pemetaan kolom file sumber → kolom impor bagan akun KAMO. Murni.
//
// Satu-satunya tempat yang boleh tahu nama kolom file dari aplikasi lain. Saat ini hanya
// template KAMO sendiri yang terdaftar.
//
// SENGAJA BELUM ADA PEMETAAN ACCURATE: belum ada contoh ekspor COA Accurate asli. Nama
// kolom Accurate tidak boleh ditebak — kolom yang salah tebak bisa memasukkan akun ke
// kelompok yang salah. Begitu contoh file asli (boleh sebagian baris, header utuh) diterima:
//   1. simpan contohnya (sudah disanitasi) di supabase/tests/fixtures dan catat SHA-256-nya;
//   2. tambahkan entri di PEMETAAN_AKUN dengan `ditinjau` terisi (siapa, kapan, hash contoh);
//   3. tambahkan tes parser → pratinjau → simpan untuk contoh itu.
// Pemetaan hanya MENGGANTI NAMA KOLOM (dan bila perlu menerjemahkan nilai tipe). Isi kode
// akun tidak pernah diubah di sini — kode yang tidak cocok kontrak KAMO tampil sebagai konflik.

export const KOLOM_AKUN_KAMO = ["kode", "nama", "tipe", "saldo_normal", "induk", "header", "aktif"] as const;
export type KolomAkun = (typeof KOLOM_AKUN_KAMO)[number];
export const KOLOM_AKUN_WAJIB: readonly KolomAkun[] = ["kode", "nama", "tipe"];

export type PemetaanSumberAkun = {
  label: string;
  /** judul kolom di file sumber (huruf kecil, dipangkas) → kolom KAMO */
  kolom: Record<string, KolomAkun>;
  /** nilai tipe di file sumber (huruf besar) → tipe KAMO; kosong = harus sudah memakai tipe KAMO */
  tipe: Record<string, string>;
  /** Wajib terisi untuk pemetaan selain template KAMO sendiri. */
  ditinjau: { oleh: string; tanggal: string; contohSha256: string } | null;
};

const identitas = Object.fromEntries(KOLOM_AKUN_KAMO.map((k) => [k, k])) as Record<string, KolomAkun>;

export const PEMETAAN_AKUN: Record<string, PemetaanSumberAkun> = {
  kamo: { label: "Template KAMO", kolom: identitas, tipe: {}, ditinjau: null },
};

export const pemetaanAkun = (id: string): PemetaanSumberAkun | null =>
  Object.prototype.hasOwnProperty.call(PEMETAAN_AKUN, id) ? PEMETAAN_AKUN[id] : null;
