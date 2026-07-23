// Logika murni Tutup Buku — dites di __tests__/tutup-buku.test.ts

export const AKUN_LABA_DITAHAN = "3201";

type Balance = { code: string; type: string; saldo: number };
export type ClosingLine = { code: string; debit: number; credit: number };

// Jurnal penutup: nol-kan semua akun PENDAPATAN & BEBAN, selisih (laba/rugi) ke Laba Ditahan.
// Pendapatan (saldo normal K) ditutup dgn Debit; Beban (saldo normal D) ditutup dgn Kredit.
export function buildClosingLines(balances: Balance[]): { lines: ClosingLine[]; laba: number } {
  const lines: ClosingLine[] = [];
  let totalPendapatan = 0;
  let totalBeban = 0;

  for (const b of balances) {
    if (b.saldo === 0) continue;
    if (b.type === "PENDAPATAN") {
      totalPendapatan += b.saldo;
      lines.push(b.saldo > 0 ? { code: b.code, debit: b.saldo, credit: 0 } : { code: b.code, debit: 0, credit: -b.saldo });
    } else if (b.type === "BEBAN") {
      totalBeban += b.saldo;
      lines.push(b.saldo > 0 ? { code: b.code, debit: 0, credit: b.saldo } : { code: b.code, debit: -b.saldo, credit: 0 });
    }
  }

  const laba = totalPendapatan - totalBeban;
  if (laba > 0) lines.push({ code: AKUN_LABA_DITAHAN, debit: 0, credit: laba });
  else if (laba < 0) lines.push({ code: AKUN_LABA_DITAHAN, debit: -laba, credit: 0 });

  return { lines, laba };
}
