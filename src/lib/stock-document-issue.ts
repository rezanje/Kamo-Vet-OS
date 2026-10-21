import type { StockCorrectionKind } from "./stock-correction-types";

/** Only these two source families record exact issued lots for future correction. */
export async function issueStockDocument(db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> }, kind: StockCorrectionKind, documentId: string, itemId: string): Promise<{ cost: number }> {
  const { data, error } = await db.rpc("issue_stock_document_recorded", { p_kind: kind, p_id: documentId, p_item_id: itemId });
  if (error) throw new Error(error.message);
  const result = data as { cost?: unknown } | null;
  if (!result || !Number.isFinite(Number(result.cost)) || result.cost === null || result.cost === undefined || Number(result.cost) < 0) throw new Error("Pengeluaran stok belum terkonfirmasi. Periksa dokumen asal sebelum menyimpan ulang.");
  return { cost: Number(result.cost) };
}
