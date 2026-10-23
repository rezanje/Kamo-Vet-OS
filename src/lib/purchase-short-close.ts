export type ReceiptCloseRow = {
  id: string; nama?: string; qty: number; qty_terima: number | null; qty_rusak?: number | null;
  satuan: string | null; faktor: number;
};
export type ReceiptClosure = {
  po_id: string; actor_id: string; actor_name: string; closed_at: string; reason: string;
  lines: { id: string; ordered_qty: number; received_qty: number; closed_qty: number; satuan: string | null; faktor: number; received_was_null?: boolean }[];
};
/** Displayed snapshot only; the RPC compares it to locked source rows. */
export function receiptCloseSnapshot(rows: ReceiptCloseRow[]) {
  return rows.map(row => ({ id: row.id, qty: Number(row.qty), qty_terima: Number(row.qty_terima ?? 0), qty_rusak: Number(row.qty_rusak ?? 0), satuan: row.satuan, faktor: Number(row.faktor) })).sort((a, b) => a.id.localeCompare(b.id));
}
