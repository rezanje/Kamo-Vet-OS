// Logika murni Retur Pembelian/Penjualan — dites di __tests__/retur.test.ts

// Nomor dokumen: RB.YYYY.MM.NNNNN (beli) / RJ.YYYY.MM.NNNNN (jual), seq per bulan.
export function formatNoRetur(jenis: "RB" | "RJ", date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${jenis}.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Sisa qty yang masih boleh diretur per item = qty sumber − akumulasi retur sebelumnya.
export function sisaRetur(
  sumber: Record<string, number>,
  sudahRetur: Record<string, number>,
): Record<string, number> {
  const sisa: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(sumber)) {
    const rem = qty - (sudahRetur[itemId] ?? 0);
    if (rem > 0) sisa[itemId] = rem;
  }
  return sisa;
}

// Total nilai retur = Σ qty × harga.
export function totalRetur(rows: { qty: number; harga: number }[]): number {
  return rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.harga) || 0), 0);
}
