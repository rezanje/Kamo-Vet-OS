// Saldo Awal — memasukkan harta & utang yang sudah ADA sebelum sistem dipakai.
//
// Tanpa ini, buku besar cuma tahu transaksi yang terjadi DI DALAM sistem: stok yang
// diimpor lewat master tidak pernah didebit ke Persediaan, aset lama bersumber
// "saldo-awal" tidak pernah didebit ke Aset Tetap, tapi penjualan mengkredit Persediaan
// dan penyusutan mengkredit Akumulasi tiap bulan. Hasilnya Persediaan & Aset Tetap
// menjadi MINUS dan Neraca menampilkan total aktiva negatif — walau tetap "seimbang",
// karena selisihnya diam-diam jatuh ke laba berjalan.
//
// Logika murni di sini; pembacaan DB & posting ada di layar Saldo Awal.

export const AKUN_MODAL_PEMILIK = "3101";

export type BarisSaldoAwal = { code: string; nilai: number; sisi: "D" | "K" };
export type JurnalBaris = { code: string; debit: number; credit: number };

/**
 * Nilai yang perlu dimasukkan sebagai saldo awal = kondisi NYATA dikurangi apa yang
 * sudah tercatat di buku besar. Kalau buku besar sudah benar, hasilnya 0 dan tidak
 * ada yang perlu diposting — jadi layar ini aman dibuka berkali-kali.
 */
export function selisihSaldoAwal(nilaiNyata: number, saldoBuku: number): number {
  const selisih = Math.round(Number(nilaiNyata) || 0) - Math.round(Number(saldoBuku) || 0);
  return selisih;
}

/**
 * Jurnal saldo awal. Pemakai mengisi harta & utangnya; SELISIHNYA otomatis jadi
 * Modal Pemilik — itu memang definisi modal (harta dikurangi utang), sekaligus
 * jaminan jurnal ini tidak mungkin timpang.
 */
export function jurnalSaldoAwal(
  baris: BarisSaldoAwal[],
  kodeModal: string = AKUN_MODAL_PEMILIK,
): { lines: JurnalBaris[]; modal: number } {
  const lines: JurnalBaris[] = [];
  let totalD = 0;
  let totalK = 0;

  for (const b of baris) {
    const nilai = Math.round(Number(b.nilai) || 0);
    if (nilai === 0) continue;
    // Nilai negatif = lawan sisinya (mis. koreksi aset yang kelebihan dicatat).
    const sisi: "D" | "K" = nilai > 0 ? b.sisi : b.sisi === "D" ? "K" : "D";
    const abs = Math.abs(nilai);
    if (sisi === "D") { lines.push({ code: b.code, debit: abs, credit: 0 }); totalD += abs; }
    else { lines.push({ code: b.code, debit: 0, credit: abs }); totalK += abs; }
  }

  const modal = totalD - totalK;
  if (modal > 0) lines.push({ code: kodeModal, debit: 0, credit: modal });
  else if (modal < 0) lines.push({ code: kodeModal, debit: -modal, credit: 0 });

  return { lines, modal };
}

/** Nilai persediaan menurut lapisan FIFO yang masih tersisa. */
export function nilaiPersediaan(layers: { qty_left: number; unit_cost: number }[]): number {
  return layers.reduce((a, l) => a + Number(l.qty_left) * Number(l.unit_cost), 0);
}
