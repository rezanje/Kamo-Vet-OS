/**
 * Koreksi tagihan yang sudah ada tidak boleh menurunkan total di bawah uang yang sudah DITERIMA (DP di kepala tagihan + semua baris
 * invoice_payments, termasuk uang yang dipindahkan dari nota lama pada Void & Terbit Ulang). Database menolaknya
 * (clinic_edit_invoice_core: total < dp_amount + sum(pembayaran) -> "INVOICE_INVALID: nilai koreksi tidak konsisten"); fungsi ini hanya
 * menjelaskan penolakan itu SEBELUM RPC dengan angka yang jelas. Aturannya sama persis dengan database; database tetap penentu.
 */
export const formatRupiahKoreksi = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

/** Uang yang sudah diterima = dp_amount + jumlah semua baris pembayaran (pembalikan bernilai negatif ikut dihitung, seperti di database). */
export function uangSudahDiterima(dpAmount: number, pembayaran: readonly { amount: number | string | null }[]): number {
  return (Number(dpAmount) || 0) + pembayaran.reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

/** Pesan penolakan bila total baru lebih kecil dari uang diterima; null bila aman diteruskan ke database. */
export function pesanKoreksiDiBawahUangDiterima(totalBaru: number, diterima: number): string | null {
  const total = Math.round((Number(totalBaru) || 0) * 100) / 100;
  const uang = Math.round((Number(diterima) || 0) * 100) / 100;
  if (!(total < uang)) return null;
  return `Total baru ${formatRupiahKoreksi(total)} lebih kecil dari uang yang sudah diterima pada tagihan ini (${formatRupiahKoreksi(uang)}). `
    + `Koreksi tidak bisa menurunkan tagihan di bawah uang yang sudah dibayar: selisih ${formatRupiahKoreksi(uang - total)} harus dikembalikan ke pelanggan `
    + `dan itu belum bisa dicatat dari layar ini. Belum ada yang tersimpan. Jangan ulangi; hubungi tim pengembang/keuangan untuk menyelesaikan `
    + `pengembalian selisihnya, atau pertahankan total sama atau lebih besar.`;
}
