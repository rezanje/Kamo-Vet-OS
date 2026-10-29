// Deposit rawat inap — titipan uang pemilik selama pasien dirawat.
//
// Uang titipan BUKAN omzet. Dia memakai akun kewajiban yang sama dengan Uang Muka
// Penjualan grosir (2103): kas bertambah, utang klinik kepada pemilik bertambah.
// Saat tagihan pulang terbit, titipan memotong tagihan — utang turun, piutang
// lunas — bukan penerimaan kas kedua. Semua rumus di file ini murni dan dipakai
// layar, server action, dan pemeriksa teks migrasi supaya angkanya satu sumber.

import { AKUN_PIUTANG, AKUN_UANG_MUKA_JUAL, type JurnalLine } from "./penjualan-dokumen";

export { AKUN_PIUTANG, AKUN_UANG_MUKA_JUAL };
/** Akun titipan pelanggan. Sengaja memakai ulang akun uang muka penjualan. */
export const AKUN_DEPOSIT_RANAP = AKUN_UANG_MUKA_JUAL;

/** Batas nominal satu deposit — sama dengan batas yang ditegakkan database. */
export const BATAS_DEPOSIT = 1_000_000_000_000;

const bulat = (n: number) => Math.round(Number(n) || 0);

/** Terima titipan: kas bertambah, utang ke pemilik bertambah. */
export function jurnalDepositMasuk(kasCode: string, jumlah: number): JurnalLine[] {
  const n = bulat(jumlah);
  if (n <= 0) return [];
  return [
    { code: kasCode, debit: n, credit: 0 },
    { code: AKUN_DEPOSIT_RANAP, debit: 0, credit: n },
  ];
}

/** Batal titipan (belum terpakai sama sekali) dan kembalikan sisa titipan: kebalikan dari terima. */
export function jurnalDepositKeluar(kasCode: string, jumlah: number): JurnalLine[] {
  const n = bulat(jumlah);
  if (n <= 0) return [];
  return [
    { code: AKUN_DEPOSIT_RANAP, debit: n, credit: 0 },
    { code: kasCode, debit: 0, credit: n },
  ];
}

/** Titipan dipakai menutup tagihan: utang turun, piutang lunas. Tidak ada kas bergerak. */
export function jurnalDepositDipakai(jumlah: number): JurnalLine[] {
  const n = bulat(jumlah);
  if (n <= 0) return [];
  return [
    { code: AKUN_DEPOSIT_RANAP, debit: n, credit: 0 },
    { code: AKUN_PIUTANG, debit: 0, credit: n },
  ];
}

/** Tagihan dibatalkan: piutang hidup lagi, titipan kembali jadi saldo pemilik. */
export function jurnalDepositDilepas(jumlah: number): JurnalLine[] {
  const n = bulat(jumlah);
  if (n <= 0) return [];
  return [
    { code: AKUN_PIUTANG, debit: n, credit: 0 },
    { code: AKUN_DEPOSIT_RANAP, debit: 0, credit: n },
  ];
}

export type BarisDeposit = {
  jumlah: number | string;
  terpakai?: number | string | null;
  dikembalikan?: number | string | null;
  status?: string | null;
};

/** Sisa satu deposit yang masih bisa dipakai atau dikembalikan. */
export function sisaDeposit(d: BarisDeposit): number {
  if ((d.status ?? "aktif") !== "aktif") return 0;
  const sisa = Number(d.jumlah || 0) - Number(d.terpakai || 0) - Number(d.dikembalikan || 0);
  return sisa > 0 ? sisa : 0;
}

/** Saldo titipan satu kunjungan = jumlah sisa semua depositnya yang masih aktif. */
export function saldoDeposit(rows: readonly BarisDeposit[]): number {
  return rows.reduce((total, d) => total + sisaDeposit(d), 0);
}

/** Titipan tidak pernah boleh memotong lebih besar daripada tagihannya. */
export function depositDipakai(saldo: number, totalTagihan: number): number {
  const s = Math.max(0, Number(saldo) || 0);
  const t = Math.max(0, Number(totalTagihan) || 0);
  return Math.min(s, t);
}

/** Sisa yang masih harus dibayar pemilik setelah deposit dan pembayaran lain. */
export function sisaSetelahDeposit(total: number, sudahDibayar: number, deposit: number): number {
  const sisa = (Number(total) || 0) - (Number(sudahDibayar) || 0) - (Number(deposit) || 0);
  return sisa > 0 ? sisa : 0;
}

/** Kelebihan titipan di atas tagihan — tetap jadi saldo pemilik, bisa dikembalikan. */
export function kelebihanDeposit(saldo: number, totalTagihan: number): number {
  return Math.max(0, (Number(saldo) || 0) - depositDipakai(saldo, totalTagihan));
}

/** Batal hanya boleh selama titipan belum menempel di tagihan mana pun. */
export function bolehBatalDeposit(d: BarisDeposit): boolean {
  return (d.status ?? "aktif") === "aktif"
    && Number(d.terpakai || 0) === 0 && Number(d.dikembalikan || 0) === 0;
}

export const PERAN_PENGELOLA_DEPOSIT = ["OWNER", "ADMIN", "FINANCE"] as const;
export function bolehKelolaDeposit(role: string | null | undefined): boolean {
  return (PERAN_PENGELOLA_DEPOSIT as readonly string[]).includes(String(role ?? ""));
}

/** Validasi nominal di server action; database memeriksa hal yang sama sekali lagi. */
export function periksaJumlahDeposit(input: unknown): string | null {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return "Isi nominal deposit lebih besar dari nol.";
  if (Math.round(n * 100) !== n * 100) return "Nominal deposit maksimal dua angka di belakang koma.";
  if (n > BATAS_DEPOSIT) return "Nominal deposit melebihi batas yang diizinkan.";
  return null;
}

export type BarisKasDeposit = {
  jumlah: number | string;
  dikembalikan?: number | string | null;
  metode: string;
  shift_id?: string | null;
  void_shift_id?: string | null;
  refund_shift_id?: string | null;
};

/**
 * Uang titipan yang benar-benar melewati laci shift ini: diterima saat deposit
 * dicatat, keluar lagi saat deposit dibatalkan atau sisanya dikembalikan.
 * Deposit yang dipakai menutup tagihan TIDAK muncul di sini — tidak ada uang
 * fisik yang berpindah saat itu.
 */
export function depositKasShift(
  rows: readonly BarisKasDeposit[], shiftId: string,
): { total: number; metode_bayar: string }[] {
  const hasil: { total: number; metode_bayar: string }[] = [];
  for (const d of rows) {
    const jumlah = Number(d.jumlah) || 0;
    if (d.shift_id === shiftId && jumlah !== 0) hasil.push({ total: jumlah, metode_bayar: d.metode });
    if (d.void_shift_id === shiftId && jumlah !== 0) hasil.push({ total: -jumlah, metode_bayar: d.metode });
    const kembali = Number(d.dikembalikan) || 0;
    if (d.refund_shift_id === shiftId && kembali !== 0) hasil.push({ total: -kembali, metode_bayar: d.metode });
  }
  return hasil;
}

/** Pesan error database (P0001) diterjemahkan ke bahasa kasir. */
export function pesanErrorDeposit(error: { code?: string; message?: string } | null | undefined): string {
  const pesan = String(error?.message ?? "");
  const tabel: [string, string][] = [
    ["DEPOSIT_CLOSED", "Pasien sudah pulang. Terima uangnya lewat layar Pembayaran, bukan deposit."],
    ["DEPOSIT_USED", "Deposit sudah terpakai di tagihan. Batalkan lewat void tagihannya, bukan di sini."],
    ["DEPOSIT_EMPTY", "Tidak ada sisa deposit yang bisa dikembalikan."],
    ["DEPOSIT_NO_INVALID", "Format nomor deposit belum benar. Periksa Pengaturan → Penomoran Dokumen."],
    ["DEPOSIT_INVALID", "Data deposit belum lengkap atau tidak valid. Periksa isian lalu coba lagi."],
    ["SHIFT_INVALID", "Mulai shift klinik dulu sebelum menerima atau mengembalikan uang."],
    ["ACCESS_DENIED", "Akun ini tidak berhak melakukan tindakan tersebut."],
    ["ACCOUNT_INVALID", "Rekening penerimaan belum disiapkan. Hubungi admin keuangan."],
    ["IDEMPOTENCY_CONFLICT", "Kunci transaksi sudah dipakai untuk data berbeda. Muat ulang halaman."],
    ["JOURNAL_MISSING", "Jurnal deposit tidak terbentuk. Deposit tidak disimpan."],
  ];
  for (const [kode, ramah] of tabel) if (pesan.includes(kode)) return ramah;
  return pesan.trim() || "Deposit belum tersimpan. Periksa daftar deposit sebelum mencoba lagi.";
}
