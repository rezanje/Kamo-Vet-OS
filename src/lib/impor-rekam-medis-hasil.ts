/**
 * Periksa hasil impor rekam medis dari layar impor (RS-1).
 *
 * Riwayat bersama hasil impor tidak terlihat di halaman pasien saat cabang aktif dipilih. Layar impor
 * membacanya lewat RPC baca-saja `hasil_impor_rekam_medis` yang dibatasi database: 1–500 jejak per
 * panggilan, jejak 1–500 karakter, maksimal 500 baris, hanya OWNER/ADMIN aktif. Batas yang sama
 * diterapkan di sini supaya permintaan yang pasti ditolak tidak dikirim.
 */

export const MAKS_PERIKSA_HASIL_REKAM_MEDIS = 500;
export const MAKS_PANJANG_JEJAK_REKAM_MEDIS = 500;

export type HasilImporRekamMedis = {
  kunci: string;
  visit_id: string;
  jejak_tersimpan: string;
  tanggal: string | null;
  pemilik: string | null;
  hewan: string | null;
  dokter: string | null;
  keluhan: string | null;
  diagnosis: string | null;
  anamnesis: string | null;
  gejala_klinis: string | null;
  terapi: string | null;
};

/** Jejak yang boleh dikirim ke RPC: dirapikan, unik, tanpa yang kosong/terlalu panjang. Melempar bila tidak sah. */
export function kunciPeriksaHasil(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("Daftar riwayat yang mau diperiksa tidak terbaca.");
  const unik = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const kunci = item.trim();
    if (!kunci || kunci.length > MAKS_PANJANG_JEJAK_REKAM_MEDIS) continue;
    unik.add(kunci);
  }
  if (!unik.size) throw new Error("Belum ada riwayat tersimpan untuk diperiksa.");
  if (unik.size > MAKS_PERIKSA_HASIL_REKAM_MEDIS) {
    throw new Error(`Maksimal ${MAKS_PERIKSA_HASIL_REKAM_MEDIS} riwayat sekali periksa.`);
  }
  return [...unik];
}

/**
 * Daftar jejak tersimpan di tab: unik, urutan terakhir disimpan di belakang, dibatasi supaya impor
 * sebesar apa pun tidak menumpuk di memori. Yang terlama dibuang lebih dulu.
 */
export function catatKunciTersimpan(sebelum: readonly string[], baru: readonly string[], maks = MAKS_PERIKSA_HASIL_REKAM_MEDIS): string[] {
  const urut = new Map<string, true>();
  for (const kunci of [...sebelum, ...baru]) {
    if (!kunci) continue;
    urut.delete(kunci);
    urut.set(kunci, true);
  }
  const semua = [...urut.keys()];
  return semua.length > maks ? semua.slice(semua.length - maks) : semua;
}

function teks(value: unknown): string | null {
  return value == null ? null : String(value);
}

/** Jawaban RPC menjadi baris tampilan; baris tanpa jejak/kunjungan dibuang. */
export function barisHasilImpor(data: unknown): HasilImporRekamMedis[] {
  if (!Array.isArray(data)) throw new Error("Pemeriksaan hasil tidak memberi jawaban. Coba lagi.");
  return data.flatMap((item): HasilImporRekamMedis[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (typeof row.kunci !== "string" || typeof row.visit_id !== "string") return [];
    return [{
      kunci: row.kunci,
      visit_id: row.visit_id,
      jejak_tersimpan: String(row.jejak_tersimpan ?? row.kunci),
      tanggal: teks(row.tanggal),
      pemilik: teks(row.pemilik),
      hewan: teks(row.hewan),
      dokter: teks(row.dokter),
      keluhan: teks(row.keluhan),
      diagnosis: teks(row.diagnosis),
      anamnesis: teks(row.anamnesis),
      gejala_klinis: teks(row.gejala_klinis),
      terapi: teks(row.terapi),
    }];
  });
}

/** Ringkasan satu baris untuk tabel: isi klinis pertama yang ada, dipotong. */
export function ringkasIsiKlinis(row: HasilImporRekamMedis, maks = 140): string {
  const isi = [row.diagnosis, row.anamnesis, row.gejala_klinis, row.terapi, row.keluhan].find((value) => value && value.trim());
  if (!isi) return "—";
  const rapi = isi.trim().replace(/\s+/g, " ");
  return rapi.length > maks ? `${rapi.slice(0, maks - 1)}…` : rapi;
}
