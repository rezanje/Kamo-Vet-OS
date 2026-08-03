// Logika murni Perintah Pembayaran (migrasi 0096) — dites di __tests__/perintah-bayar.test.ts

// Nomor dokumen: PP.YYYY.MM.NNNNN, seq per bulan — pola sama dgn FB/TB/UM.
export function formatNoPerintahBayar(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `PP.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

/**
 * Sisa hutang tiap faktur.
 *
 * Perintah bayar yang masih menunggu (draft/disetujui) ikut dipotong: kalau tidak,
 * satu faktur bisa masuk ke dua perintah bayar sekaligus dan terbayar dua kali.
 */
export function sisaFakturBayar(
  faktur: { id: string; total: number }[],
  pembayaran: { invoice_id: string; amount: number }[],
  antrean: { invoice_id: string; jumlah: number }[],
): Map<string, number> {
  const dibayar = new Map<string, number>();
  for (const p of pembayaran) {
    dibayar.set(p.invoice_id, (dibayar.get(p.invoice_id) ?? 0) + Number(p.amount));
  }
  for (const a of antrean) {
    dibayar.set(a.invoice_id, (dibayar.get(a.invoice_id) ?? 0) + Number(a.jumlah));
  }

  const sisa = new Map<string, number>();
  for (const f of faktur) {
    sisa.set(f.id, Math.max(0, Number(f.total) - (dibayar.get(f.id) ?? 0)));
  }
  return sisa;
}
