"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type LinePreview = {
  path: "unreceived" | "invoice"; nama: string; satuan: string | null;
  old_qty: number; new_qty: number; old_qty_terima: number; new_qty_terima: number;
  old_harga: number; new_harga: number; old_total: number; total: number; old_status: string; status: string;
  no_faktur: string | null; old_harga_faktur: number | null; removed_qty: number; sold_qty: number; remaining_qty: number;
  ap_delta: number; ppn_delta: number; inventory_delta: number; hpp_delta: number;
};

export type LineInput = { poItemId: string; qty: number | null; qtyTerima: number | null; harga: number; tanggal: string };

/** Pratinjau dampak edit baris PO: jalur yang sama persis dengan simpan, lalu dibatalkan di database. */
export async function pratinjauBarisPO(input: LineInput): Promise<{ ok: true; preview: LinePreview } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_purchase_order_line_correction", {
    p_po_item_id: input.poItemId, p_qty: input.qty, p_qty_terima: input.qtyTerima, p_harga: input.harga, p_tanggal: input.tanggal,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "Pratinjau belum tersedia. Coba lagi." };
  return { ok: true, preview: data as LinePreview };
}

/** Simpan edit baris PO. Hasil dikembalikan ke pop-up (bukan redirect) supaya pesan gagal tampil di dalam pop-up. */
export async function simpanBarisPO(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const poId = String(formData.get("po_id") ?? "");
  const back = `/pembelian/${poId}`;
  const num = (name: string) => { const raw = String(formData.get(name) ?? "").trim(); return raw === "" ? null : Number(raw); };
  let expected: unknown = null;
  try { expected = JSON.parse(String(formData.get("expected") ?? "null")); } catch { /* RPC menolak tanpa pratinjau. */ }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_purchase_order_line", {
    p_request_key: String(formData.get("request_key") ?? ""), p_po_item_id: String(formData.get("po_item_id") ?? ""),
    p_expected_revision: Number(formData.get("revision")), p_qty: num("qty"), p_qty_terima: num("qty_terima"), p_harga: num("harga"),
    p_tanggal: String(formData.get("tanggal") ?? ""), p_reason: String(formData.get("alasan") ?? "").trim(), p_expected: expected,
  });
  if (error || data?.po_id !== poId) return { ok: false, error: error?.message ?? "Perubahan belum terkonfirmasi. Muat ulang lalu periksa baris sebelum mengulang." };
  for (const path of [back, "/pembelian", "/pembelian/faktur", "/pembelian/penerimaan", "/keuangan/hutang", "/laporan/pembelian"]) revalidatePath(path);
  return { ok: true };
}
