// Logika murni Faktur Pembelian — dites di __tests__/faktur-beli.test.ts

// Nomor internal: FB.YYYY.MM.NNNNN (seq per bulan, pola pemindahan/retur).
export function formatNoFaktur(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `FB.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Jurnal faktur: Dr 2102 (nilai PO porsi difakturkan) / Cr 2101 (nilai faktur);
// selisih harga → 1301 (Dr bila faktur lebih mahal, Cr bila lebih murah).
export type JurnalLine = { code: string; debit: number; credit: number };

export function buildFakturLines(nilaiPO: number, nilaiFaktur: number): JurnalLine[] {
  if (nilaiPO <= 0 && nilaiFaktur <= 0) return [];
  const lines: JurnalLine[] = [
    { code: "2102", debit: nilaiPO, credit: 0 },
    { code: "2101", debit: 0, credit: nilaiFaktur },
  ];
  const selisih = nilaiFaktur - nilaiPO;
  if (selisih > 0) lines.push({ code: "1301", debit: selisih, credit: 0 });
  else if (selisih < 0) lines.push({ code: "1301", debit: 0, credit: -selisih });
  return lines.filter((l) => l.debit > 0 || l.credit > 0);
}

// Sisa qty PO yang masih boleh difakturkan per item (reuse pola sisaRetur).
export function sisaFakturable(
  qtyPO: Record<string, number>,
  sudahDifakturkan: Record<string, number>,
): Record<string, number> {
  const sisa: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(qtyPO)) {
    const rem = qty - (sudahDifakturkan[itemId] ?? 0);
    if (rem > 0) sisa[itemId] = rem;
  }
  return sisa;
}
