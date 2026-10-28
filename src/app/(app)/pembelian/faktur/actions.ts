"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { nomorBerikutnya } from "@/lib/no-dokumen";
import { hariIniWIB } from "@/lib/tanggal";
import { cekPeriode } from "@/lib/jurnal-guard";
import { cekPersetujuan } from "@/lib/persetujuan-server";
import { priceCheckBeforeSave } from "@/lib/purchase-price-check";

type ItemInput = { po_item_id: string; qty: number; harga: number };

export async function buatFaktur(formData: FormData) {
  if (formData.get("tindakan") === "periksa") return recoverInvoiceSubmission(formData);
  const supabase = await createClient();
  const replacement = String(formData.get("replaces_invoice_id") ?? "");
  const back = `/pembelian/faktur/baru${replacement ? `?replace_invoice=${encodeURIComponent(replacement)}&` : "?"}`;
  const fail = (message: string): never => redirect(`${back}error=${encodeURIComponent(message)}`);
  const requestKey = String(formData.get("draft_key") ?? formData.get("request_key") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "");
  let items: ItemInput[];
  try { items = JSON.parse(String(formData.get("items") ?? "[]")); } catch { return fail("Rincian faktur tidak dapat dibaca."); }
  if (!Array.isArray(items) || !items.length || items.some(r => !r || !r.po_item_id || !Number.isFinite(r.qty) || r.qty <= 0 || !Number.isFinite(r.harga) || r.harga < 0)) return fail("Periksa jumlah dan harga barang.");
  // N01: receipts this invoice covers; stored atomically with the invoice by the database.
  let receiptIds: string[];
  try { receiptIds = JSON.parse(String(formData.get("receipt_ids") ?? "[]")); } catch { return fail("Pilihan penerimaan tidak dapat dibaca."); }
  if (!Array.isArray(receiptIds) || receiptIds.some(id => typeof id !== "string" || !id)) return fail("Pilihan penerimaan tidak valid. Muat ulang formulir.");
  const payload = {
    po_id: String(formData.get("po_id") ?? ""), tanggal,
    jatuh_tempo: String(formData.get("jatuh_tempo") ?? ""),
    no_faktur_pemasok: String(formData.get("no_faktur_pemasok") ?? "").trim() || null,
    keterangan: String(formData.get("keterangan") ?? "").trim() || null,
    items: items.map(r => ({ po_item_id: r.po_item_id, qty: r.qty, harga: r.harga })).sort((a, b) => a.po_item_id.localeCompare(b.po_item_id)),
    ...(replacement ? { replaces_invoice_id: replacement } : {}),
  };
  const finish = (id: string): never => {
    for (const path of ["/pembelian/faktur", "/keuangan/hutang", "/laporan/pembelian", "/pembelian/perintah-bayar", "/"]) revalidatePath(path);
    redirect(`/pembelian/faktur/${id}?success=${encodeURIComponent("Faktur tersimpan. Stok dan pembukuan sudah diperbarui.")}${transactionDraftAck(formData)}`);
  };
  const { data: recovered, error: recoveryError } = await supabase.rpc("recover_purchase_operation", { p_kind: "invoice", p_request_key: requestKey, p_payload: payload });
  if (recoveryError) fail(recoveryError.message);
  if (recovered?.invoice_id) {
    // N01: a replayed key must also carry the same receipt choice that was stored with the invoice.
    const { data: stored, error: storedError } = await supabase.from("purchase_invoice_receipts")
      .select("goods_receipt_id").eq("invoice_id", recovered.invoice_id);
    if (storedError || !Array.isArray(stored)) fail("Penerimaan faktur tersimpan belum dapat diperiksa. Periksa hasil terakhir sebelum mengulang.");
    const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
    if (!same((stored ?? []).map(row => String(row.goods_receipt_id)), receiptIds))
      fail("Faktur ini sudah tersimpan dengan pilihan penerimaan berbeda. Periksa hasil terakhir sebelum mengulang.");
    finish(recovered.invoice_id);
  }
  // P04: harga faktur per satuan PO ÷ faktor baris PO, dibanding harga pokok acuan. Gagal baca = tanpa peringatan.
  const { data: poLines } = await supabase.from("purchase_order_items").select("id,item_id,faktor").in("id", payload.items.map(r => r.po_item_id));
  const poLine = new Map(((poLines ?? []) as { id: string; item_id: string | null; faktor: number | null }[]).map(r => [r.id, r]));
  const hargaCek = await priceCheckBeforeSave(supabase, formData, payload.items.map(r => ({ item_id: poLine.get(r.po_item_id)?.item_id, harga: r.harga, factor: poLine.get(r.po_item_id)?.faktor })));
  if (hargaCek) redirect(`${back}harga_cek=${encodeURIComponent(hargaCek)}`);
  const { prefix, digit } = await nomorBerikutnya(supabase, "FB", tanggal, { table: "purchase_invoices", column: "no_faktur" });
  const total = items.reduce((sum, row) => sum + row.qty * row.harga, 0);
  const { ppn } = splitPpnInklusif(total, await getPajakSettings(supabase));
  const { data, error } = await supabase.rpc("create_purchase_invoice_from_po_receipts", {
    p_po_id: payload.po_id, p_request_key: requestKey, p_no_faktur_prefix: prefix, p_no_faktur_digits: digit,
    p_no_faktur_pemasok: payload.no_faktur_pemasok, p_tanggal: tanggal, p_jatuh_tempo: payload.jatuh_tempo,
    p_keterangan: payload.keterangan, p_items: payload.items, p_layer_updates: [], p_layer_inserts: [], p_ppn: ppn,
    p_replaces_invoice_id: replacement || null, p_receipt_ids: receiptIds,
  });
  if (error) fail(error.message);
  const created = Array.isArray(data) ? data[0] : data;
  if (!created?.invoice_id || !created.no_jurnal) fail("Hasil faktur belum terkonfirmasi. Periksa hasil terakhir sebelum mengulang.");
  finish(created.invoice_id);
}

export async function recoverInvoiceSubmission(formData: FormData) {
  const supabase = await createClient();
  const kind = String(formData.get("invoice_kind") ?? "invoice");
  if (!["invoice", "invoice-direct"].includes(kind)) throw new Error("Jenis faktur tidak valid.");
  const { data, error } = await supabase.rpc("get_purchase_operation_result", { p_kind: kind, p_request_key: String(formData.get("draft_key") ?? "") });
  if (error) throw new Error(error.message);
  if (!data?.invoice_id || !data.no_jurnal) throw new Error("Belum ada hasil tersimpan untuk formulir ini. Rincian tetap tersedia untuk diperiksa.");
  redirect(`/pembelian/faktur/${data.invoice_id}?success=${encodeURIComponent("Faktur sudah tersimpan dan terkonfirmasi.")}${transactionDraftAck(formData)}`);
}

// Bayar hutang per faktur; invoice/PO/advance/payment/journal share one database transaction.
export async function bayarFaktur(formData: FormData) {
  const supabase=await createClient();const back="/keuangan/hutang";
  const invoiceId=String(formData.get("invoice_id")??"");
  const requestKey=String(formData.get("draft_key")??"");
  const amount=Number(formData.get("amount"));
  const metode=String(formData.get("metode")??"Transfer");
  const tanggal=String(formData.get("tanggal")??"")||hariIniWIB();
  const catatan=String(formData.get("catatan")??"").trim()||null;
  const accountId=String(formData.get("account_id")??"").trim()||null;
  const advanceId=String(formData.get("advance_id")??"").trim()||null;
  const fail=(message:string):never=>redirect(`${back}?error=${encodeURIComponent(message)}`);
  if(!invoiceId||!requestKey||!Number.isFinite(amount)||amount<=0)fail("Nominal atau identitas pembayaran tidak valid. Muat ulang formulir.");
  if(!Number.isInteger(amount))fail("Nominal pembayaran harus dalam rupiah bulat.");
  const replacesPaymentId=String(formData.get("replaces_payment_id")??"").trim()||null;
  const payload={invoice_id:invoiceId,tanggal,amount,metode,catatan,account_id:accountId,advance_id:advanceId,replaces_payment_id:replacesPaymentId};
  const finish=(noFaktur:string):never=>{revalidatePath(back);redirect(`${back}?success=${encodeURIComponent(`Pembayaran ${noFaktur} tersimpan.`)}${transactionDraftAck(formData)}`);};
  const {data:recovered,error:recoveryError}=await supabase.rpc("recover_purchase_payment",{p_request_key:requestKey,p_payload:payload});
  if(recoveryError)fail(recoveryError.message);
  if(recovered?.no_faktur)finish(recovered.no_faktur);
  const pesanPeriode=await cekPeriode(supabase,tanggal);if(pesanPeriode)fail(pesanPeriode);
  const {data:inv,error:invoiceError}=await supabase.from("purchase_invoices").select("id,no_faktur").eq("id",invoiceId).maybeSingle();
  if(invoiceError||!inv)fail("Faktur tidak ditemukan.");
  const {data:{user}}=await supabase.auth.getUser();
  const izin=await cekPersetujuan(supabase,{jenis:"bayar-faktur",refId:invoiceId,nilai:amount,noDokumen:inv!.no_faktur,keterangan:`Pembayaran faktur ${inv!.no_faktur} sebesar Rp ${Math.round(amount).toLocaleString("id-ID")}`,userId:user?.id??null,deferConsumption:true});
  if(!izin.boleh)fail(izin.pesan??"Transaksi ini butuh persetujuan atasan.");
  const {data:result,error}=await supabase.rpc("pay_purchase_invoice_atomic",{p_request_key:requestKey,p_invoice_id:invoiceId,p_tanggal:tanggal,p_amount:amount,p_metode:metode,p_catatan:catatan,p_account_id:accountId,p_advance_id:advanceId,p_replaces_payment_id:replacesPaymentId});
  if(error)fail(error.message);
  if(!result?.payment_id||!result?.journal_id||!result?.no_faktur)throw new Error("Pembayaran belum terkonfirmasi lengkap. Periksa transaksi sebelum menyimpan ulang.");
  finish(result.no_faktur);
}
