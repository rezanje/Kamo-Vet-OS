// Logika murni Pemindahan Barang (kloning Accurate) — dites di __tests__/pemindahan.test.ts

export type StatusKirim = "Sedang dikirim" | "Diterima Sebagian" | "Diterima Seluruhnya";

// Nomor dokumen format Accurate: IT.YYYY.MM.NNNNN (seq per bulan).
export function formatNoPemindahan(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `IT.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Status dokumen Kirim berdasarkan total qty dikirim vs total qty sudah diterima.
export function hitungStatusKirim(totalDikirim: number, totalDiterima: number): StatusKirim {
  if (totalDiterima <= 0) return "Sedang dikirim";
  if (totalDiterima >= totalDikirim) return "Diterima Seluruhnya";
  return "Diterima Sebagian";
}

// Sisa qty per item yang masih di Transit untuk satu dokumen Kirim.
// dikirim: qty per item_id; diterima: akumulasi qty per item_id dari semua dokumen Terima.
export function sisaTransit(
  dikirim: Record<string, number>,
  diterima: Record<string, number>,
): Record<string, number> {
  const sisa: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(dikirim)) {
    const rem = qty - (diterima[itemId] ?? 0);
    if (rem > 0) sisa[itemId] = rem;
  }
  return sisa;
}
