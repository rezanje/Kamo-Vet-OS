/**
 * Dry-run OFFLINE (bawaan): baca master + rencana. Nol panggilan jaringan, nol mutasi, tanpa auth/cabang.
 * Laporan hanya berisi ID lokal, status, kode alasan, dan hitungan — tanpa nama, HP, isi klinis, atau source_key mentah.
 * Status di database TIDAK diketahui di mode ini (bukan bukti baru/ganda).
 */
import { bacaMaster } from "./baca-master";
import { buatRencana, OPSI_BAWAAN_TANGGAL_MINIMUM, type HitunganRencana, type StatusRencana } from "./rencana";

export type LaporanDryRun = {
  ok: boolean;
  mode: "dry-run-offline";
  catatan: string;
  galat: string[];
  versi: string | null;
  sha256Berkas: string | null;
  sidikRencana: string | null;
  peringatan: string[];
  hitungan: HitunganRencana | null;
  baris: {
    local_record_id: string; status: StatusRencana; disetujui: boolean; alasan: string[]; peringatan: string[]; bentukJejak: string | null;
    /** Kekurangan bila kartu bisa masuk "Perlu Dilengkapi" (kode saja, tanpa isi). */
    tertunda: string[] | null;
  }[];
};

/** Tanggal hari ini menurut WIB (YYYY-MM-DD). */
export function hariIniWib(sekarang = new Date()): string {
  return new Date(sekarang.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export const CATATAN_DRY_RUN = "Dry-run offline: kelayakan review, BUKAN otorisasi produksi. Tidak ada panggilan jaringan; status di database tidak diketahui.";

export type OpsiDryRun = { hariIni?: string; tanggalMinimum?: string; persetujuanBerkas?: string };

export async function dryRunOffline(bytes: Uint8Array, opsi: OpsiDryRun = {}): Promise<LaporanDryRun> {
  const dasar = { mode: "dry-run-offline" as const, catatan: CATATAN_DRY_RUN };
  const hasil = await bacaMaster(bytes);
  if (!hasil.ok) {
    return { ...dasar, ok: false, galat: hasil.galat, versi: null, sha256Berkas: hasil.sha256, sidikRencana: null, peringatan: [], hitungan: null, baris: [] };
  }
  if (opsi.persetujuanBerkas !== undefined && opsi.persetujuanBerkas !== hasil.sha256) {
    return { ...dasar, ok: false, galat: ["Persetujuan berkas tidak cocok dengan SHA-256 berkas yang dibaca."], versi: hasil.versi, sha256Berkas: hasil.sha256, sidikRencana: null, peringatan: [], hitungan: null, baris: [] };
  }
  const rencana = buatRencana(hasil.versi, hasil.sha256, hasil.blok, {
    hariIni: opsi.hariIni ?? hariIniWib(),
    tanggalMinimum: opsi.tanggalMinimum ?? OPSI_BAWAAN_TANGGAL_MINIMUM,
    ...(opsi.persetujuanBerkas !== undefined ? { persetujuanBerkas: opsi.persetujuanBerkas } : {}),
  }, hasil.peringatan);
  return {
    ...dasar, ok: true, galat: [], versi: rencana.versi, sha256Berkas: rencana.sha256Berkas, sidikRencana: rencana.sidikRencana,
    peringatan: rencana.peringatan, hitungan: rencana.hitungan,
    baris: rencana.baris.map((r) => ({ local_record_id: r.local_record_id, status: r.status, disetujui: r.disetujui, alasan: r.alasan, peringatan: r.peringatan, bentukJejak: r.bentukJejak, tertunda: r.tertunda?.kekurangan ?? null })),
  };
}
