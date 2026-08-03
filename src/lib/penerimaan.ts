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

// ── Dokumen penerimaan (migrasi 0093) ────────────────────────────────────────

// Nomor dokumen: TB.YYYY.MM.NNNNN, seq per bulan — pola sama dgn FB/RB/RJ.
export function formatNoTerima(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `TB.${y}.${m}.${String(seq).padStart(5, "0")}`;
}

export type BarisTerima = {
  qty: number;                 // qty PO
  sudahTerima: number;         // akumulasi yang sudah diterima baik
  mintaTerima: number;         // input: datang & kondisinya baik
  mintaRusak: number;          // input: datang tapi ditolak karena rusak
  harga: number;
};

export type HasilBaris = {
  sisaSebelum: number;
  terima: number;
  rusak: number;
  totalTerima: number;         // akumulasi setelah dokumen ini
  nilai: number;               // yang dijurnal & menambah hutang
};

/**
 * Bagi input satu penerimaan jadi angka yang siap disimpan.
 *
 * Barang rusak TIDAK dipotong dari sisa pesanan: pemasok masih berhutang kiriman
 * pengganti. Kalau rusaknya mengurangi sisa, sisa kiriman jadi hilang diam-diam
 * dan barangnya tidak akan pernah ditagih.
 */
export function hitungBarisTerima(b: BarisTerima): HasilBaris {
  const qty = Number(b.qty) || 0;
  const sudah = Math.max(0, Number(b.sudahTerima) || 0);
  const sisaSebelum = Math.max(0, qty - sudah);

  const terima = Math.min(Math.max(0, Number(b.mintaTerima) || 0), sisaSebelum);
  // Rusak dibatasi sisa setelah yang baik diambil — total yang datang tidak boleh
  // melebihi yang dipesan.
  const rusak = Math.min(Math.max(0, Number(b.mintaRusak) || 0), Math.max(0, sisaSebelum - terima));

  return {
    sisaSebelum,
    terima,
    rusak,
    totalTerima: sudah + terima,
    nilai: terima * (Number(b.harga) || 0),
  };
}
