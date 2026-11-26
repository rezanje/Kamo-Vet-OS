export type StockCorrectionKind = "adjustment" | "opname";
export type StockCorrectionRow = { item_id: string; name: string; qty: number; qty_sistem: number; selisih: number; value?: number };
export type StockCorrectionInput = { item_id: string; qty: number };
/** Baris yang diubah tetapi ditahan server (alasan per baris, selalu diawali nama barang di sisi server). Baris itu tidak diubah sama sekali. */
export type StockCorrectionBlocked = { item_id?: string; name: string; old_qty?: number; new_qty?: number; reason: string };
export type StockCorrectionPreview = {
  token: string; revision: number;
  lines: { item_id: string; name: string; old_qty: number; new_qty: number; stock_before: number; stock_after: number; delta: number }[];
  value_before: number; value_after: number; value_delta: number;
  /** Jumlah baris yang akan diterapkan dan daftar baris tertahan. Server lama tidak mengirimnya. */
  applied?: number; blocked?: StockCorrectionBlocked[];
};
export type StockCorrectionResult = { correction_id: string; document_id: string; revision: number; applied?: number; blocked?: StockCorrectionBlocked[] };
export type StockCorrectionHistory = { id: string; revision: number; reason: string; created_at: string; created_by: string; before_rows: StockCorrectionRow[]; after_rows: StockCorrectionRow[]; reversal_journal_ids: string[]; replacement_journal_id: string | null };
export type StockCorrectionState = { rows: StockCorrectionRow[]; revision: number; history: StockCorrectionHistory[] };
