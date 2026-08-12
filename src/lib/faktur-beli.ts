// Logika murni Faktur Pembelian — dites di __tests__/faktur-beli.test.ts

// Nomor internal: FB.YYYY.MM.NNNNN (seq per bulan, pola pemindahan/retur).
export function formatNoFaktur(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `FB.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

// Jurnal faktur: Dr 2102 (nilai PO porsi difakturkan) / Cr 2101 (nilai faktur);
// ppn (Mode PKP): Dr 1105 PPN Masukan; sisa selisih → 1301 (koreksi nilai persediaan).
export type JurnalLine = { code: string; debit: number; credit: number };

export function buildFakturLines(nilaiPO: number, nilaiFaktur: number, ppn = 0): JurnalLine[] {
  if (nilaiPO <= 0 && nilaiFaktur <= 0) return [];
  const lines: JurnalLine[] = [
    { code: "2102", debit: nilaiPO, credit: 0 },
    { code: "2101", debit: 0, credit: nilaiFaktur },
  ];
  if (ppn > 0) lines.push({ code: "1105", debit: ppn, credit: 0 });
  const selisih = nilaiFaktur - ppn - nilaiPO;
  if (selisih > 0) lines.push({ code: "1301", debit: selisih, credit: 0 });
  else if (selisih < 0) lines.push({ code: "1301", debit: 0, credit: -selisih });
  return lines.filter((l) => l.debit > 0 || l.credit > 0);
}

/**
 * Jurnal faktur pembelian LANGSUNG (tanpa PO, barang masuk di dokumen yang sama).
 *
 * Barangnya belum pernah lewat 2102 Hutang Belum Difakturkan — tidak ada
 * penerimaan terpisah — jadi tidak ada saldo GRNI untuk dilawan. Satu dokumen
 * menggabungkan "barang masuk" dan "utang timbul":
 *
 *   Dr 1301 Persediaan   = DPP
 *   Dr 1105 PPN Masukan  = PPN (kalau mode PKP aktif)
 *   Cr 2101 Hutang Usaha = total faktur
 *
 * Persediaan dinilai sebesar DPP, bukan total: PPN Masukan bisa dikreditkan, jadi
 * ia bukan bagian dari harga pokok barang. Nilai lapisan stok WAJIB memakai dasar
 * yang sama — kalau tidak, saldo 1301 di buku besar dan nilai stok berpisah sejak
 * faktur pertama. Saat mode PKP mati, dpp = total sehingga tidak ada bedanya.
 */
export function buildFakturLangsungLines(total: number, ppn = 0): JurnalLine[] {
  const nilai = Number(total) || 0;
  if (nilai <= 0) return [];
  const pajak = Math.max(0, Math.min(Number(ppn) || 0, nilai));
  const dpp = nilai - pajak;
  return [
    ...(dpp > 0 ? [{ code: "1301", debit: dpp, credit: 0 }] : []),
    ...(pajak > 0 ? [{ code: "1105", debit: pajak, credit: 0 }] : []),
    { code: "2101", debit: 0, credit: nilai },
  ];
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
