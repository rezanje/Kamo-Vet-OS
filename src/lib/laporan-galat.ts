/**
 * Pesan galat laporan yang spesifik: dulu semua kegagalan baca tampil sebagai satu kalimat umum, sehingga
 * "database kehabisan waktu" dan "akun tidak berhak" tidak bisa dibedakan. Hanya teks/kode galat yang diklasifikasi;
 * isi mentahnya tetap hanya masuk log server, tidak ditampilkan ke pengguna.
 */
export type KodeGalatLaporan = "batas_waktu" | "izin" | "koneksi" | "periode" | "umum";

export const PESAN_GALAT_LAPORAN: Record<Exclude<KodeGalatLaporan, "periode">, string> = {
  batas_waktu: "Laporan melewati batas waktu database sebelum selesai dibaca. Coba lagi sebentar lagi atau pilih periode lebih pendek.",
  izin: "Akun ini tidak punya izin membaca data laporan ini. Hubungi Owner bila seharusnya boleh.",
  koneksi: "Koneksi ke database terputus saat laporan dibaca. Coba lagi sebentar lagi.",
  umum: "Laporan belum bisa dibaca. Coba lagi atau pilih periode lebih pendek.",
};

const TIMEOUT = /statement timeout|canceling statement|57014|query[_ ]?timeout|timed? ?out|upstream request timeout|gateway time-?out/i;
const IZIN = /permission denied|42501|row-level security|ADMIN_ONLINE_FUNCTION_DENIED|not authorized|unauthorized|JWT (expired|invalid)|PGRST30[0-9]/i;
const KONEKSI = /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|connection (terminated|closed|reset)/i;

export function klasifikasiGalatLaporan(error: unknown): { kode: KodeGalatLaporan; pesan: string } {
  const pesan = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const kode = typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "";
  if (pesan.startsWith("Periode memuat")) return { kode: "periode", pesan };
  const teks = `${kode} ${pesan}`;
  // Kode 57014 (query dibatalkan karena batas waktu) pasti batas waktu; teks "timeout" dihitung batas waktu kecuali galat izin.
  if (kode === "57014" || (!IZIN.test(teks) && TIMEOUT.test(teks))) return { kode: "batas_waktu", pesan: PESAN_GALAT_LAPORAN.batas_waktu };
  if (IZIN.test(teks)) return { kode: "izin", pesan: PESAN_GALAT_LAPORAN.izin };
  if (KONEKSI.test(teks)) return { kode: "koneksi", pesan: PESAN_GALAT_LAPORAN.koneksi };
  return { kode: "umum", pesan: PESAN_GALAT_LAPORAN.umum };
}

/** Status HTTP untuk unduhan: izin 403, batas waktu 504, koneksi 503, lainnya 400 (seperti sebelumnya). */
export function statusGalatLaporan(kode: KodeGalatLaporan | undefined): number {
  return kode === "izin" ? 403 : kode === "batas_waktu" ? 504 : kode === "koneksi" ? 503 : 400;
}
