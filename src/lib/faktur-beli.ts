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

export type PoItemUntukFaktur = {
  id: string;
  item_id: string | null;
  diterima: number;
  faktor: number;
};

export type ItemFakturPoTersimpan = {
  po_item_id: string | null;
  item_id: string | null;
  qty: number;
  faktor: number | null;
};

export type HasilSisaFakturPerBaris = {
  /** Qty tersisa dalam satuan PO untuk tiap baris PO. */
  sisaPerBaris: Record<string, number>;
  /** SKU yang tidak bisa dialokasikan ke baris PO karena faktur lama tanpa po_item_id. */
  legacyAmbiguousItemIds: string[];
  /** Baris PO dengan faktor tidak valid atau baris faktur tertaut yang rusak/orphan. */
  invalidPoItemIds: string[];
  invalidLinkedLines: boolean;
};

/**
 * Sisa faktur dihitung per baris PO dan dikonversi melalui satuan dasar.
 *
 * Faktur lama dari PO tidak menyimpan po_item_id. Ia hanya dapat dialokasikan
 * secara aman jika SKU muncul sekali di PO itu; untuk SKU duplikat hasil lama
 * mencampur beberapa satuan, jadi caller harus menghentikan faktur baru.
 */
export function sisaFakturablePerBaris(
  poItems: PoItemUntukFaktur[],
  invoiceItems: ItemFakturPoTersimpan[],
): HasilSisaFakturPerBaris {
  const byId = new Map(poItems.map((row) => [row.id, row]));
  const byItem = new Map<string, PoItemUntukFaktur[]>();
  const billedBaseByPoItem: Record<string, number> = {};
  const invalidPoItemIds = new Set<string>();
  const legacyAmbiguousItemIds = new Set<string>();
  let invalidLinkedLines = false;

  for (const row of poItems) {
    const factor = Number(row.faktor);
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(Number(row.diterima)) || Number(row.diterima) < 0) {
      invalidPoItemIds.add(row.id);
    }
    if (row.item_id) {
      const rows = byItem.get(row.item_id) ?? [];
      rows.push(row);
      byItem.set(row.item_id, rows);
    }
  }

  for (const line of invoiceItems) {
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      if (line.po_item_id && byId.has(line.po_item_id)) invalidPoItemIds.add(line.po_item_id);
      else if (line.po_item_id) invalidLinkedLines = true;
      continue;
    }

    if (line.po_item_id) {
      const poItem = byId.get(line.po_item_id);
      const factor = Number(line.faktor);
      if (!poItem) {
        invalidLinkedLines = true;
        continue;
      }
      if (!line.item_id || line.item_id !== poItem.item_id || !Number.isFinite(factor) || factor <= 0) {
        invalidPoItemIds.add(poItem.id);
        continue;
      }
      billedBaseByPoItem[poItem.id] = (billedBaseByPoItem[poItem.id] ?? 0) + qty * factor;
      continue;
    }

    if (!line.item_id) continue;
    const matches = byItem.get(line.item_id) ?? [];
    if (matches.length > 1) {
      legacyAmbiguousItemIds.add(line.item_id);
    } else if (matches.length === 1) {
      const match = matches[0];
      // Faktur lama PO menyalin qty dari baris PO, tetapi satuannya tidak disimpan.
      billedBaseByPoItem[match.id] = (billedBaseByPoItem[match.id] ?? 0) + qty * Number(match.faktor);
    }
  }

  const sisaPerBaris: Record<string, number> = {};
  for (const row of poItems) {
    if (!row.item_id || invalidPoItemIds.has(row.id) || legacyAmbiguousItemIds.has(row.item_id)) continue;
    const factor = Number(row.faktor);
    const diterimaBase = Number(row.diterima) * factor;
    const sisaBase = Math.max(0, diterimaBase - (billedBaseByPoItem[row.id] ?? 0));
    if (sisaBase > 0) sisaPerBaris[row.id] = sisaBase / factor;
  }

  return {
    sisaPerBaris,
    legacyAmbiguousItemIds: [...legacyAmbiguousItemIds].sort(),
    invalidPoItemIds: [...invalidPoItemIds].sort(),
    invalidLinkedLines,
  };
}

export type LapisanStokFaktur = {
  id: string;
  warehouse_id: string;
  item_id: string;
  tanggal: string;
  qty_in: number;
  qty_left: number;
  unit_cost: number;
  source: string;
  source_ref: string | null;
  exp_date: string | null;
  batch_no: string | null;
};

export type RencanaUpdateLapisan = {
  id: string;
  expected_qty_in: number;
  expected_qty_left: number;
  expected_unit_cost: number;
  qty_in?: number;
  qty_left?: number;
  unit_cost?: number;
};

/**
 * Reprice only the part of a purchase layer still in stock. A partial portion
 * becomes a sibling layer so its remaining units keep the correct new cost.
 */
export function rencanakanRepriceLapisan(
  layers: LapisanStokFaktur[],
  qtyBase: number,
  unitCostBase: number,
): { updates: RencanaUpdateLapisan[]; inserts: Omit<LapisanStokFaktur, "id">[]; qtyTidakTerpenuhi: number } {
  let remaining = Math.max(0, Number(qtyBase) || 0);
  const updates: RencanaUpdateLapisan[] = [];
  const inserts: Omit<LapisanStokFaktur, "id">[] = [];

  for (const layer of layers) {
    if (remaining <= 0) break;
    const qtyLeft = Math.max(0, Number(layer.qty_left) || 0);
    const take = Math.min(qtyLeft, remaining);
    if (take <= 0) continue;

    if (take >= qtyLeft - 1e-9) {
      updates.push({
        id: layer.id,
        expected_qty_in: Number(layer.qty_in),
        expected_qty_left: Number(layer.qty_left),
        expected_unit_cost: Number(layer.unit_cost),
        unit_cost: unitCostBase,
      });
    } else {
      updates.push({
        id: layer.id,
        expected_qty_in: Number(layer.qty_in),
        expected_qty_left: Number(layer.qty_left),
        expected_unit_cost: Number(layer.unit_cost),
        qty_in: Math.max(0, Number(layer.qty_in) - take),
        qty_left: Math.max(0, qtyLeft - take),
      });
      const { id: _id, ...rest } = layer;
      void _id;
      inserts.push({ ...rest, qty_in: take, qty_left: take, unit_cost: unitCostBase });
    }
    remaining = Math.max(0, remaining - take);
  }

  return { updates, inserts, qtyTidakTerpenuhi: remaining };
}
