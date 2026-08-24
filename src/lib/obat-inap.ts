// Protokol obat rawat inap — logika murni, dites di __tests__/obat-inap.test.ts.
//
// Yang dijawab di sini persis pertanyaan drh. Ilham: obat ini sudah masuk hari ke
// berapa dari protokolnya, sudah diberikan berapa kali, dan hari ini masih kurang
// berapa dosis. Semuanya dihitung dari catatan pemberian yang benar-benar ada —
// bukan dari asumsi jadwal berjalan lancar.

import { tanggalWIB } from "./tanggal";

export type Protokol = {
  id: string;
  namaObat: string;
  dosis: string | null;
  rute: string | null;
  frekuensiPerHari: number;
  durasiHari: number;
  mulaiTanggal: string;          // YYYY-MM-DD
  dihentikanAt: string | null;
};

export type Pemberian = {
  id: string;
  medicationId: string;
  diberikanAt: string;           // ISO
  namaPemberi: string | null;
  catatan: string | null;
  dibatalkanAt: string | null;
};

/** Tanggal WIB dari sebuah waktu ISO — dipakai mengelompokkan dosis per hari. */
export const tanggalWib = tanggalWIB;

/** Selisih hari kalender antara dua tanggal YYYY-MM-DD. */
export function selisihHari(dari: string, sampai: string): number {
  const a = new Date(`${dari}T00:00:00Z`).getTime();
  const b = new Date(`${sampai}T00:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 864e5);
}

export type Progres = {
  /** Hari ke berapa protokol ini berjalan pada tanggal acuan; 0 = belum mulai. */
  hariKe: number;
  durasiHari: number;
  /** Total pemberian sah (tidak dibatalkan) sejak protokol dimulai. */
  totalDiberikan: number;
  /** Target total sampai hari acuan, mis. 3 hari × 4 kali = 12. */
  targetSampaiHariIni: number;
  diberikanHariIni: number;
  frekuensiPerHari: number;
  /** Sisa dosis yang seharusnya masih diberikan hari ini. */
  kurangHariIni: number;
  /** Protokolnya sudah lewat masa berlakunya atau dihentikan dokter. */
  selesai: boolean;
  /** Tertinggal dari jadwal pada hari-hari sebelumnya, bukan hari ini. */
  tertinggal: number;
};

/**
 * Hitung posisi protokol pada `hariIni` (YYYY-MM-DD).
 *
 * Hari ke-1 adalah tanggal mulai. Protokol yang belum mulai memberi hariKe 0
 * supaya layar bisa menampilkan "belum dimulai" alih-alih angka menyesatkan.
 */
export function progresObat(p: Protokol, dosis: Pemberian[], hariIni: string): Progres {
  const sah = dosis.filter((d) => d.medicationId === p.id && !d.dibatalkanAt);
  const lewat = selisihHari(p.mulaiTanggal, hariIni);
  const hariKe = lewat < 0 ? 0 : Math.min(lewat + 1, p.durasiHari);

  const dihentikan = !!p.dihentikanAt;
  const selesai = dihentikan || lewat + 1 > p.durasiHari;

  const totalDiberikan = sah.length;
  const diberikanHariIni = sah.filter((d) => tanggalWib(d.diberikanAt) === hariIni).length;
  const targetSampaiHariIni = hariKe * p.frekuensiPerHari;

  const kurangHariIni = selesai || hariKe === 0
    ? 0
    : Math.max(0, p.frekuensiPerHari - diberikanHariIni);

  // Yang tertinggal dihitung dari target hari-hari SEBELUMNYA saja: kekurangan
  // hari ini masih wajar karena harinya belum habis.
  const targetSebelumHariIni = Math.max(0, (hariKe - 1) * p.frekuensiPerHari);
  const tertinggal = Math.max(0, targetSebelumHariIni - (totalDiberikan - diberikanHariIni));

  return {
    hariKe, durasiHari: p.durasiHari,
    totalDiberikan, targetSampaiHariIni,
    diberikanHariIni, frekuensiPerHari: p.frekuensiPerHari,
    kurangHariIni, selesai, tertinggal,
  };
}

/** Kalimat pendek untuk layar: "Hari ke-2 dari 3 · 5 dari 12 pemberian". */
export function ringkasProgres(pr: Progres): string {
  if (pr.hariKe === 0) return "Belum dimulai";
  const inti = `Hari ke-${pr.hariKe} dari ${pr.durasiHari} · ${pr.totalDiberikan} dari ${pr.durasiHari * pr.frekuensiPerHari} pemberian`;
  return pr.selesai ? `${inti} · protokol selesai` : inti;
}

/** Peringatan protokol untuk papan pemantauan. Kosong = semua sesuai jadwal. */
export function peringatanObat(daftar: { protokol: Protokol; progres: Progres }[]): string[] {
  const pesan: string[] = [];
  for (const { protokol, progres } of daftar) {
    if (progres.selesai) continue;
    if (progres.tertinggal > 0) {
      pesan.push(`${protokol.namaObat} tertinggal ${progres.tertinggal} pemberian dari jadwal`);
    } else if (progres.kurangHariIni > 0) {
      pesan.push(`${protokol.namaObat} kurang ${progres.kurangHariIni}× hari ini`);
    }
  }
  return pesan;
}
