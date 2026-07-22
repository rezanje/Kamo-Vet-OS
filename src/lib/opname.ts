// Logika murni Stok Opname — dites di __tests__/opname.test.ts

// Nomor dokumen format Accurate: OPO.00385 / OPR.00362 (seq global).
export function formatNoOpname(prefix: "OPO" | "OPR", seq: number): string {
  return `${prefix}.${String(seq).padStart(5, "0")}`;
}

export type OpnameRow = { qty_sistem: number; qty_fisik: number; buy_price: number };

// Nilai penyesuaian: total nilai barang lebih (fisik > sistem) & kurang (fisik < sistem).
export function nilaiSelisih(rows: OpnameRow[]): { lebih: number; kurang: number } {
  let lebih = 0, kurang = 0;
  for (const r of rows) {
    const diff = (Number(r.qty_fisik) || 0) - (Number(r.qty_sistem) || 0);
    const nilai = Math.abs(diff) * (Number(r.buy_price) || 0);
    if (diff > 0) lebih += nilai;
    else if (diff < 0) kurang += nilai;
  }
  return { lebih, kurang };
}
