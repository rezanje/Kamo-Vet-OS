// Request receipt, stock movement and completion commit in one database transaction.
import { nomorBerikutnya } from "./no-dokumen";
import { hariIniWIB } from "./tanggal";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type BarisTerima = {
  id: string;
  item_id: string | null;
  nama?: string;
  qty_diminta?: number;
  qty_diterima: number;
  kondisi: string;
  notes?: string;
};

export type HasilTerima =
  | { ok: true; receiptNumber: string; selisih: number }
  | { ok: false; error: string };

/** Nomor dokumen penerimaan; formatnya dibaca dari master penomoran (bawaan TRM-YYMMDD-NNN). */
export async function nomorPenerimaan(supabase: AnyClient): Promise<string> {
  const { nomor } = await nomorBerikutnya(supabase, "TRM", hariIniWIB(), {
    table: "stock_receipts", column: "receipt_number",
  });
  return nomor;
}

export async function prosesTerimaPermintaan(
  supabase: AnyClient,
  o: { requestId: string; branchId: string; receivedBy: string | null; rows: BarisTerima[] },
): Promise<HasilTerima> {
  if (!o.requestId || !o.rows.length) return { ok: false, error: "Pilih permintaan dan barang yang diterima." };
  const { data, error } = await supabase.rpc("receive_stock_request_atomic", {
    p_request_id: o.requestId, p_branch_id: o.branchId,
    p_rows: o.rows.map(r => ({ id: r.id, qty_diterima: Number(r.qty_diterima), kondisi: r.kondisi || "baik", notes: r.notes ?? "" })),
  });
  if (error) return { ok: false, error: error.message };
  const result = Array.isArray(data) ? data[0] : data;
  if (!result) return { ok: false, error: "Hasil penerimaan kosong." };
  return { ok: true, receiptNumber: result.receipt_number, selisih: Number(result.selisih) };
}
