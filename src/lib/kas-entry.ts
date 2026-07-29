// Kas Masuk / Kas Keluar (petty cash, migrasi 0072) — logika murni, tanpa DB.
// Pelunasan hutang/piutang TIDAK lewat sini: itu terikat faktur dan punya modulnya
// sendiri. Di sini uang kas yang tidak punya faktur.

import type { JurnalBaris } from "./transfer-kas";

export type JenisKas = "Masuk" | "Keluar";

export function hrefKas(jenis: JenisKas): string {
  return jenis === "Masuk" ? "/kas-bank/kas-masuk" : "/kas-bank/kas-keluar";
}

export type KasDraft = {
  jenis: JenisKas;
  tanggal: string;
  accountId: string;
  lawanCode: string;
  jumlah: number;
  hariIni: string; // YYYY-MM-DD di zona WIB
};

export function validasiKasEntry(d: KasDraft): string | null {
  if (d.jenis !== "Masuk" && d.jenis !== "Keluar") return "Jenis transaksi tidak dikenal";
  if (!d.accountId) return "Rekening kas/bank wajib dipilih";
  if (!d.lawanCode) return "Akun lawan wajib dipilih";
  if (!Number.isFinite(d.jumlah) || d.jumlah <= 0) return "Jumlah harus lebih dari 0";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.tanggal)) return "Tanggal tidak valid";
  if (d.tanggal > d.hariIni) return "Tanggal tidak boleh di masa depan";
  return null;
}

// Kas masuk  : Dr rekening kas/bank, Cr akun lawan (pendapatan lain / setoran).
// Kas keluar : Dr akun lawan (beban), Cr rekening kas/bank.
export function jurnalKasEntry(
  jenis: JenisKas, kodeRekening: string, lawanCode: string, jumlah: number,
): JurnalBaris[] {
  const nilai = Number(jumlah) || 0;
  return jenis === "Masuk"
    ? [
        { code: kodeRekening, debit: nilai, credit: 0 },
        { code: lawanCode, debit: 0, credit: nilai },
      ]
    : [
        { code: lawanCode, debit: nilai, credit: 0 },
        { code: kodeRekening, debit: 0, credit: nilai },
      ];
}

// KM = Kas Masuk, KK = Kas Keluar. Nomor per bulan, pola sama dgn TF/RB/RJ.
export function nomorKasEntry(jenis: JenisKas, tanggal: string, jumlahBulanIni: number): string {
  const [y, m] = tanggal.split("-");
  const awalan = jenis === "Masuk" ? "KM" : "KK";
  return `${awalan}.${y}.${m}.${String(jumlahBulanIni + 1).padStart(5, "0")}`;
}

// Rekening kas/bank tidak boleh jadi akun LAWAN-nya sendiri: itu bukan kas masuk/
// keluar, melainkan transfer antar rekening — modulnya sudah ada sendiri.
export function akunLawanTerlarang(kodeRekeningKas: string[]): Set<string> {
  return new Set(kodeRekeningKas.map((k) => String(k).trim()));
}
