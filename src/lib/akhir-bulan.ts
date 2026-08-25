// Proses akhir bulan otomatis (S8) — logika murni, dites di __tests__/akhir-bulan.test.ts.
//
// Sebelum ini tiga pekerjaan awal bulan dikerjakan manual dan gampang terlewat:
// posting penyusutan aset, posting jurnal berulang (sewa, langganan), dan mengunci
// bulan yang sudah lewat. Yang ketiga paling mahal kalau lupa — transaksi bisa
// disisipkan ke bulan yang laporannya sudah dikirim ke pemilik.

/** Bulan yang BARU SAJA selesai, dilihat dari `hariIni` (YYYY-MM-DD). */
export function periodeSelesai(hariIni: string): string {
  const y = Number(hariIni.slice(0, 4));
  const m = Number(hariIni.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Tanggal terakhir sebuah periode YYYY-MM. */
export function tanggalTerakhir(periode: string): string {
  const y = Number(periode.slice(0, 4));
  const m = Number(periode.slice(5, 7));
  const hari = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${periode}-${String(hari).padStart(2, "0")}`;
}

export function selisihHari(dari: string, sampai: string): number {
  const a = new Date(`${dari}T00:00:00Z`).getTime();
  const b = new Date(`${sampai}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 864e5);
}

/**
 * Boleh mengunci bulan yang sudah selesai?
 *
 * `jedaHari` = masa tenggang setelah bulan berakhir, untuk transaksi susulan yang
 * wajar (faktur pemasok datang terlambat, setoran kasir hari terakhir baru dicatat
 * tanggal 2). Mengunci tepat tengah malam tanggal 1 membuat pekerjaan itu mustahil
 * tanpa membuka kunci lagi — dan kunci yang sering dibuka bukan kunci.
 */
export function bolehKunci(o: {
  hariIni: string;
  periode: string;
  jedaHari: number;
  terkunciSampai: string | null;
}): boolean {
  const akhir = tanggalTerakhir(o.periode);
  if (o.terkunciSampai && o.terkunciSampai >= akhir) return false;  // sudah terkunci
  return selisihHari(akhir, o.hariIni) >= Math.max(0, o.jedaHari);
}

export type HasilAkhirBulan = {
  periode: string;
  penyusutan: { periode: string; total: number; jumlahAset: number }[];
  jurnalBerulang: { nama: string; periode: string }[];
  dikunciSampai: string | null;
  /** Alasan kunci dilewati; null kalau memang dikunci atau memang tidak diminta. */
  kunciDilewati: string | null;
};

export function ringkasHasil(h: HasilAkhirBulan): string {
  const bagian = [
    `${h.penyusutan.length} periode penyusutan`,
    `${h.jurnalBerulang.length} jurnal berulang`,
    h.dikunciSampai ? `terkunci s/d ${h.dikunciSampai}` : (h.kunciDilewati ?? "tanpa penguncian"),
  ];
  return bagian.join(" · ");
}
