export type StockCorrectionKind = "adjustment" | "opname";
export type StockCorrectionRow = { item_id: string; name: string; qty: number; qty_sistem: number; selisih: number; value?: number };
export type StockCorrectionInput = { item_id: string; qty: number };
export type StockCorrectionPreview = {
  token: string; revision: number;
  lines: { item_id: string; name: string; old_qty: number; new_qty: number; stock_before: number; stock_after: number; delta: number }[];
  value_before: number; value_after: number; value_delta: number;
};
export type StockCorrectionResult = { correction_id: string; document_id: string; revision: number };
export type StockCorrectionHistory = { id: string; revision: number; reason: string; created_at: string; created_by: string; before_rows: StockCorrectionRow[]; after_rows: StockCorrectionRow[]; reversal_journal_ids: string[]; replacement_journal_id: string | null };
export type StockCorrectionState = { rows: StockCorrectionRow[]; revision: number; history: StockCorrectionHistory[] };
