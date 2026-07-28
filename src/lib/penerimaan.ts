// Logika murni Penerimaan Barang — dites di __tests__/penerimaan.test.ts
//
// Barang yang datang belum tentu sama dengan yang di-PO. Sumber kebenaran
// setelah PO diterima = qty_terima; sebelum diterima jatuh balik ke qty PO.

export type PoiQty = { qty: number; qty_terima?: number | null };

// Qty efektif satu baris PO.
export function qtyDiterima(row: PoiQty): number {
  const v = row.qty_terima ?? row.qty;
  return Number(v) || 0;
}

// Qty efektif per item_id (baris tanpa item_id/master SKU diabaikan — tak pengaruh stok).
export function qtyDiterimaPerItem(
  rows: ({ item_id: string | null } & PoiQty)[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.item_id) continue;
    out[r.item_id] = (out[r.item_id] ?? 0) + qtyDiterima(r);
  }
  return out;
}

// Nilai barang yang benar-benar diterima = Σ qty diterima × harga beli PO.
export function nilaiDiterima(rows: (PoiQty & { harga_beli: number })[]): number {
  return rows.reduce((a, r) => a + qtyDiterima(r) * (Number(r.harga_beli) || 0), 0);
}

// Ada selisih terima vs pesan? (untuk badge "sebagian"/"lebih" di daftar PO)
export function adaSelisih(rows: PoiQty[]): boolean {
  return rows.some((r) => r.qty_terima != null && Number(r.qty_terima) !== Number(r.qty));
}
