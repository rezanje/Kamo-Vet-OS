// Pemetaan kolom file sumber → kolom impor bagan akun KAMO. Murni.
//
// Satu-satunya tempat yang boleh tahu nama kolom file dari aplikasi lain. Terdaftar: template KAMO
// sendiri, dan struktur file COA pengguna (Kode/Nama Akun/Normal) yang hanya bisa dipratinjau.
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

/** Template KAMO: judul di baris pertama, kolom lengkap (termasuk tipe), bisa disimpan. */
export type PemetaanTemplateAkun = {
  jenis: "template";
  label: string;
  /** judul kolom di file sumber (huruf kecil, dipangkas) → kolom KAMO */
  kolom: Record<string, KolomAkun>;
  /** nilai tipe di file sumber (huruf besar) → tipe KAMO; kosong = harus sudah memakai tipe KAMO */
  tipe: Record<string, string>;
  /** Wajib terisi untuk pemetaan selain template KAMO sendiri. */
  ditinjau: { oleh: string; tanggal: string; contohSha256: string } | null;
};

/**
 * Struktur file yang SUDAH ditinjau tetapi belum memuat semua yang dibutuhkan KAMO untuk menyimpan
 * akun (tipe/kelompok, induk, header/posting). Hanya pratinjau; simpan dimatikan sampai keputusan
 * pemetaan disetujui dan dipasang sebagai langkah tinjauan eksplisit.
 */
export type PemetaanTerblokirAkun = {
  jenis: "terblokir";
  label: string;
  /** nama sheet persis untuk file .xlsx */
  sheet: string;
  /** teks judul kolom PERSIS (huruf besar/kecil & spasi) → kolom KAMO; baris judul dicari dengan teks ini */
  judul: { teks: string; ke: KolomAkun }[];
  /** berapa baris teratas yang boleh diperiksa untuk mencari baris judul */
  cariJudulSampai: number;
  /** nilai Normal sumber → sisi saldo; nilai lain ditolak */
  normal: Record<string, "D" | "K">;
  ditinjau: { oleh: string; tanggal: string; dasar: string; fixtureSha256: string };
  /** alasan simpan dimatikan — ditampilkan apa adanya di pratinjau */
  terblokir: string[];
};

export type PemetaanSumberAkun = PemetaanTemplateAkun | PemetaanTerblokirAkun;

const identitas = Object.fromEntries(KOLOM_AKUN_KAMO.map((k) => [k, k])) as Record<string, KolomAkun>;

export const PEMETAAN_AKUN: {
  kamo: PemetaanTemplateAkun;
  "pengguna-kode-nama-normal": PemetaanTerblokirAkun;
} = {
  kamo: { jenis: "template", label: "Template KAMO", kolom: identitas, tipe: {}, ditinjau: null },
  // Struktur file COA milik pengguna (bukan terbukti ekspor asli aplikasi lain). File aslinya tidak
  // diunggah (beberapa nama akun memuat petunjuk nomor rekening); tes memakai file SINTETIS berbentuk sama.
  "pengguna-kode-nama-normal": {
    jenis: "terblokir",
    label: "file COA pengguna (Kode/Nama Akun/Normal)",
    sheet: "Sheet1",
    judul: [{ teks: "Kode", ke: "kode" }, { teks: "Nama Akun", ke: "nama" }, { teks: "Normal", ke: "saldo_normal" }],
    cariJudulSampai: 20,
    normal: { Debit: "D", Kredit: "K" },
    ditinjau: {
      oleh: "Reza (inspeksi read-only file COA.xlsx pengguna)",
      tanggal: "2026-10-31",
      dasar: "Sheet1; baris 1–3 pembuka; judul baris 4 Kode | Nama Akun | Normal; 204 baris data; 179 kode unik 6 angka; " +
        "Normal Debit 150 / Kredit 54; 110001 ×21 dan 120001 ×6 dengan nama berbeda; tanpa kolom tipe, induk, header, saldo.",
      fixtureSha256: "cc7d84f77dbd40693f60d5b04ba4f47f4baf3736e9d50822dbd6a4144ee703ff",
    },
    terblokir: [
      "Kelompok/tipe akun (Aset, Liabilitas, Ekuitas, Pendapatan, Beban) tidak ada di file. Usulan dari digit pertama kode hanya ditampilkan, belum disetujui dan tidak dipakai.",
      "Induk/hierarki akun tidak ada di file — susunan pohon akun tidak ditebak.",
      "Akun induk (header, tidak bisa diposting) vs akun posting tidak ditandai di file.",
      "Kode yang muncul lebih dari sekali (mis. 110001, 120001) ditahan semua — perlu keputusan kode mana untuk nama mana.",
      "Nilai Normal (Debit/Kredit) dari file belum ditinjau Finance; ditampilkan sebagai nilai sumber, bukan keputusan.",
    ],
  },
};

export const pemetaanAkun = (id: string): PemetaanSumberAkun | null =>
  Object.prototype.hasOwnProperty.call(PEMETAAN_AKUN, id) ? PEMETAAN_AKUN[id as keyof typeof PEMETAAN_AKUN] : null;
