"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

import { recoverInvoiceSubmission } from "../actions";

type Row = { item_id: string; qty: number; harga: number; satuan?: string; exp_date?: string };

export async function buatFakturLangsung(formData: FormData) {
  if (formData.get("tindakan") === "periksa") return recoverInvoiceSubmission(formData);
  const supabase = await createClient();
  const replacement = String(formData.get("replaces_invoice_id") ?? "");
  const back = `/pembelian/faktur/langsung${replacement ? `?replace_invoice=${encodeURIComponent(replacement)}&` : "?"}`;
  const fail = (message: string): never => redirect(`${back}error=${encodeURIComponent(message)}`);
  let items: Row[]; let lampiran: unknown;
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); lampiran = JSON.parse(String(formData.get("lampiran") ?? "[]")); }
  catch { return fail("Rincian atau lampiran faktur tidak dapat dibaca."); }
  if (!Array.isArray(items) || !items.length || items.some(r => !r || !r.item_id || !Number.isFinite(r.qty) || r.qty <= 0 || !Number.isFinite(r.harga) || r.harga < 0)) return fail("Periksa jumlah dan harga barang.");
  const value = (name: string) => String(formData.get(name) ?? "").trim();
  const payload = {
    supplier_id: value("supplier_id"), warehouse_id: value("warehouse_id"),
    tanggal: value("tanggal"), jatuh_tempo: value("jatuh_tempo"),
    no_faktur_pemasok: value("no_faktur_pemasok") || null, surat_jalan: value("surat_jalan") || null,
    keterangan: value("keterangan") || null, lampiran,
    replaces_invoice_id: replacement || null,
    items: items.map(r => ({ item_id: r.item_id, qty: r.qty, harga: r.harga, satuan: r.satuan || null, exp_date: r.exp_date || null })),
  };
  const { data, error } = await supabase.rpc("create_direct_purchase_invoice", { p_request_key: value("draft_key"), p_payload: payload });
  if (error) fail(error.message);
  if (!data?.invoice_id || !data.no_jurnal) fail("Hasil faktur belum terkonfirmasi. Periksa hasil terakhir sebelum mengulang.");
  for (const path of ["/pembelian/faktur", "/keuangan/hutang", "/laporan/pembelian", "/dashboard"]) revalidatePath(path);
  redirect(`/pembelian/faktur/${data.invoice_id}?success=${encodeURIComponent("Faktur tersimpan. Barang sudah masuk dan pembukuan terkonfirmasi.")}${transactionDraftAck(formData)}`);
}
