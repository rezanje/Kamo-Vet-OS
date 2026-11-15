// Pengolahan bersama Laporan Visit: dipakai halaman DAN unduhan Excel/CSV,
// supaya angka layar dan berkas selalu dari saringan & rumus yang sama.
import {
  atribusiVisit, rekapVisit, saringVisit, totalCatatan, PERAN_VISIT,
  type AtribusiVisit, type BarisVisit, type PeranVisit, type RekapVisit,
} from "@/lib/laporan-visit";
import type { PilihanOrangVisit } from "./data";

export type ParamVisit = { dari?: string; sampai?: string; cabang_id?: string; orang?: string; peran?: string; tampil?: string };

export const bacaPeran = (nilai: string | undefined): PeranVisit | "" =>
  (PERAN_VISIT as string[]).includes(nilai ?? "") ? (nilai as PeranVisit) : "";

export type LaporanVisitSiap = {
  terpilih: AtribusiVisit[];
  rekap: RekapVisit[];
  /** Catatan unik di saringan (tiap baris sekali). */
  total: { visit: number; pemantauan: number; pasien: number };
  /** Pemilih orang: karyawan aktif + siapa pun yang muncul di data periode ini. */
  pilihanOrang: PilihanOrangVisit[];
};

export function olahLaporanVisit(
  rows: readonly BarisVisit[],
  karyawan: readonly PilihanOrangVisit[],
  saringan: { cabangId: string; employeeId: string; peran: PeranVisit | "" },
): LaporanVisitSiap {
  const semua = atribusiVisit(rows);
  const terpilih = saringVisit(semua, saringan);
  const barisUnik = [...new Map(terpilih.map((a) => [a.baris.id, a.baris])).values()];

  const dikenal = new Set(karyawan.map((k) => k.id));
  const dariData = new Map<string, PilihanOrangVisit>();
  for (const a of semua) {
    if (a.employeeId && !dikenal.has(a.employeeId)) {
      dariData.set(a.employeeId, { id: a.employeeId, nama: a.nama, jabatan: a.peran, branchName: null });
    }
  }
  return {
    terpilih,
    rekap: rekapVisit(terpilih),
    total: totalCatatan(barisUnik),
    pilihanOrang: [...karyawan, ...dariData.values()].sort((a, b) => a.nama.localeCompare(b.nama, "id") || a.id.localeCompare(b.id)),
  };
}
