// Rincian Tutup Shift — rumus murni untuk kartu yang difoto anak toko ke grup.
//
// Permintaan pemilik toko (VN 2 Nov 2026): laporan tutup shift harus langsung
// menampilkan total penjualan, dirinci tunai / non-tunai, lalu pengeluaran, kas
// seharusnya, kas fisik, selisih — ditambah ringkasan omset bulan berjalan
// terhadap target dan pencapaian target harian.
//
// Semua angka uang shift diambil dari `closing_breakdown` yang dikunci saat shift
// ditutup, jadi laporan yang dibuka ulang dari riwayat sama dengan yang difoto.

import { PAYMENT_METHODS } from "./shift-calc";

export type RincianPembayaran = {
  /** Semua uang penjualan shift ini (tunai + non-tunai). */
  omset: number;
  tunai: number;
  nonTunai: number;
  /** Rincian non-tunai per metode, hanya yang ada nilainya. */
  nonTunaiRincian: { metode: string; jumlah: number }[];
};

/** Pecah rekap metode bayar shift jadi tunai / non-tunai. */
export function rincianPembayaran(breakdown: Record<string, number> | null | undefined): RincianPembayaran {
  const data = breakdown ?? {};
  const urutan = [
    ...PAYMENT_METHODS,
    ...Object.keys(data).filter((m) => !(PAYMENT_METHODS as readonly string[]).includes(m)),
  ];
  const tunai = Number(data["Tunai"] ?? 0) || 0;
  const nonTunaiRincian = urutan
    .filter((m) => m !== "Tunai")
    .map((metode) => ({ metode, jumlah: Number(data[metode] ?? 0) || 0 }))
    .filter((r) => r.jumlah !== 0);
  const nonTunai = nonTunaiRincian.reduce((a, r) => a + r.jumlah, 0);
  return { omset: tunai + nonTunai, tunai, nonTunai, nonTunaiRincian };
}

export type BarisTarget = {
  periode: string; target: number; basis: string | null;
  branch_id: string | null; employee_id: string | null; category_id: string | null;
};

/**
 * Target omzet bulanan SATU cabang: baris target yang cakupannya persis cabang ini
 * (bukan per karyawan / per kategori, bukan target seluruh perusahaan) dengan basis
 * omzet. Tidak ada → null, dan kartunya bilang target belum diatur.
 */
export function targetBulananCabang(rows: readonly BarisTarget[], branchId: string, periode: string): number | null {
  const cocok = rows.filter((r) =>
    r.periode === periode && r.branch_id === branchId && !r.employee_id && !r.category_id
    && (r.basis ?? "omzet") === "omzet" && Number(r.target) > 0);
  return cocok.length ? cocok.reduce((a, r) => a + Number(r.target), 0) : null;
}

/** Jumlah hari kalender dalam periode "YYYY-MM". */
export function jumlahHariBulan(periode: string): number {
  const [thn, bln] = periode.split("-").map(Number);
  return new Date(Date.UTC(thn, bln, 0)).getUTCDate();
}

export type RingkasanTarget = {
  periode: string;
  jumlahHari: number;
  omsetBulan: number;
  penjualanHari: number;
  target: number | null;
  /** null kalau target belum diatur. */
  persenBulan: number | null;
  sisaTarget: number | null;
  targetHarian: number | null;
  persenHarian: number | null;
};

export function ringkasTarget(o: {
  periode: string; omsetBulan: number; penjualanHari: number; target: number | null;
}): RingkasanTarget {
  const jumlahHari = jumlahHariBulan(o.periode);
  const target = o.target && o.target > 0 ? o.target : null;
  const targetHarian = target === null ? null : target / jumlahHari;
  return {
    periode: o.periode,
    jumlahHari,
    omsetBulan: o.omsetBulan,
    penjualanHari: o.penjualanHari,
    target,
    persenBulan: target === null ? null : (o.omsetBulan / target) * 100,
    sisaTarget: target === null ? null : Math.max(0, target - o.omsetBulan),
    targetHarian,
    persenHarian: targetHarian === null ? null : (o.penjualanHari / targetHarian) * 100,
  };
}

const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** "2026-11" → "November 2026". */
export function namaPeriode(periode: string): string {
  const [thn, bln] = periode.split("-").map(Number);
  return `${NAMA_BULAN[bln - 1] ?? ""} ${thn}`.trim();
}

/** "2026-11" → "November". */
export function namaBulan(periode: string): string {
  return NAMA_BULAN[Number(periode.split("-")[1]) - 1] ?? "";
}

/** "2026-11-01" → "1 November 2026". */
export function tanggalPanjang(tanggal: string): string {
  const [thn, bln, hari] = tanggal.split("-").map(Number);
  if (!thn || !bln || !hari) return tanggal;
  return `${hari} ${NAMA_BULAN[bln - 1]} ${thn}`;
}
