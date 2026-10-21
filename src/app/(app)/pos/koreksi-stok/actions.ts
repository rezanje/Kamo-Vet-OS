"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { StockCorrectionKind, StockCorrectionInput, StockCorrectionPreview, StockCorrectionResult } from "@/lib/stock-correction-types";

type Reply<T> = { data?: T; error?: string; uncertain?: boolean };
const complete = (value: unknown): value is StockCorrectionResult => {
  const row = value as StockCorrectionResult | null;
  return !!row && typeof row.correction_id === "string" && typeof row.document_id === "string" && Number.isInteger(row.revision) && row.revision > 0;
};

export async function previewStockCorrection(kind: StockCorrectionKind, documentId: string, rows: StockCorrectionInput[]): Promise<Reply<StockCorrectionPreview>> {
  const db = await createClient();
  const { data, error } = await db.rpc("preview_stock_document_correction", { p_kind: kind, p_id: documentId, p_rows: rows });
  if (error) return { error: error.message };
  if (!data || typeof data.token !== "string" || !Array.isArray(data.lines)) return { error: "Preview belum terkonfirmasi. Coba periksa kembali." };
  return { data: data as StockCorrectionPreview };
}

export async function saveStockCorrection(kind: StockCorrectionKind, documentId: string, rows: StockCorrectionInput[], reason: string, requestKey: string, previewToken: string): Promise<Reply<StockCorrectionResult>> {
  const db = await createClient();
  const { data, error } = await db.rpc("correct_stock_document", { p_kind: kind, p_id: documentId, p_rows: rows, p_reason: reason, p_request_key: requestKey, p_preview_token: previewToken });
  if (error) return { error: error.message, ...(!error.code || !/^(P0001|42501|22\w{3}|23\w{3}|40\w{3})$/.test(error.code) ? { uncertain: true } : {}) };
  if (!complete(data)) return { error: "Hasil simpan belum terkonfirmasi. Periksa hasil terakhir sebelum mengoreksi lagi.", uncertain: true };
  for (const path of ["/pos/penyesuaian", "/pos/opname", "/kasir/opname", "/pos/stok", "/pos/kartu-stok", "/laporan/nilai-persediaan", "/keuangan/jurnal", "/"]) revalidatePath(path, "layout");
  return { data };
}

export async function recoverStockCorrection(kind: StockCorrectionKind, documentId: string, requestKey: string): Promise<Reply<StockCorrectionResult | null>> {
  const db = await createClient();
  const { data, error } = await db.rpc("get_stock_document_correction_result", { p_kind: kind, p_id: documentId, p_request_key: requestKey });
  if (error) return { error: error.message };
  if (data !== null && !complete(data)) return { error: "Hasil terakhir belum lengkap. Jangan membuat koreksi baru." };
  return { data };
}
