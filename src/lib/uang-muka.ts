// Logika murni Uang Muka Pembelian (migrasi 0094) — dites di __tests__/uang-muka.test.ts

export const AKUN_UANG_MUKA = "1303";

// Nomor dokumen: UM.YYYY.MM.NNNNN, seq per bulan — pola sama dgn FB/TB/RB/RJ.
export function formatNoUangMuka(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `UM.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

export type JurnalLine = { code: string; debit: number; credit: number };

/**
 * Bayar uang muka: uangnya keluar dari kas tapi belum jadi beban — masih hak tagih
 * ke pemasok sampai barangnya datang.
 */
export function jurnalUangMuka(kasCode: string, jumlah: number): JurnalLine[] {
  const n = Math.round(Number(jumlah) || 0);
  if (n <= 0) return [];
  return [
    { code: AKUN_UANG_MUKA, debit: n, credit: 0 },
    { code: kasCode, debit: 0, credit: n },
  ];
}

/**
 * Pembayaran hutang yang sebagian (atau seluruhnya) diambil dari uang muka.
 * Porsi uang muka tidak menyentuh kas — uangnya sudah keluar waktu DP dibayar.
 * Menjurnalnya lagi ke kas berarti uang yang sama keluar dua kali.
 */
export function jurnalBayarHutang(kasCode: string, total: number, dariUangMuka: number): JurnalLine[] {
  const n = Math.round(Number(total) || 0);
  if (n <= 0) return [];
  const um = Math.min(Math.max(0, Math.round(Number(dariUangMuka) || 0)), n);
  const kas = n - um;

  const lines: JurnalLine[] = [{ code: "2101", debit: n, credit: 0 }];
  if (um > 0) lines.push({ code: AKUN_UANG_MUKA, debit: 0, credit: um });
  if (kas > 0) lines.push({ code: kasCode, debit: 0, credit: kas });
  return lines;
}

/** Berapa uang muka yang boleh dipakai untuk satu pembayaran. */
export function pakaiUangMuka(sisaUangMuka: number, nominalBayar: number): number {
  const sisa = Math.max(0, Number(sisaUangMuka) || 0);
  const bayar = Math.max(0, Number(nominalBayar) || 0);
  return Math.min(sisa, bayar);
}
