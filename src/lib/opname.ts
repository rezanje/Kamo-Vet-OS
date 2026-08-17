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

/**
 * Selisih kurang dinilai harga jual atau modal? (keputusan meeting 14 Agustus)
 *
 * Petshop: HARGA JUAL — barang hilang ditanggung kepala toko, jadi yang ditagih
 * adalah nilai jualnya, bukan modalnya.
 * Klinik: MODAL — banyak obat harga jualnya nol karena cuma bahan racikan; menilai
 * pakai harga jual berarti kehilangan obat tercatat Rp 0.
 *
 * Penentunya jenis gudang dulu (satu cabang "BOTH" bisa punya gudang toko dan
 * gudang klinik sekaligus), baru jenis cabang.
 */
export function pakaiHargaJual(opts: {
  branchType?: string | null;
  warehouseType?: string | null;
}): boolean {
  const wh = (opts.warehouseType ?? "").toUpperCase();
  if (wh === "VET") return false;
  if (wh === "RETAIL") return true;
  return (opts.branchType ?? "").toUpperCase() !== "KLINIK";
}

export type BarisHitung = { item_id: string; qty_sistem: number; qty_fisik: number };

/** Barang yang hilang (fisik < sistem) beserta jumlah yang hilang — bahan faktur selisih. */
export function barangKurang(rows: BarisHitung[]): { item_id: string; qty: number }[] {
  return rows
    .map((r) => ({ item_id: r.item_id, qty: (Number(r.qty_sistem) || 0) - (Number(r.qty_fisik) || 0) }))
    .filter((r) => r.qty > 0);
}

/**
 * Nilai faktur selisih: harga jual normal × jumlah yang hilang.
 * Flat tanpa promo/diskon — ini tagihan ke kepala toko, bukan transaksi pelanggan.
 */
export function nilaiFakturSelisih(
  kurang: { item_id: string; qty: number }[],
  hargaJual: Map<string, number>,
): number {
  return kurang.reduce((a, r) => a + r.qty * (hargaJual.get(r.item_id) ?? 0), 0);
}
