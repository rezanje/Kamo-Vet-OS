"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function segarkan(invoiceId: string, returnId?: string) {
  for (const path of ["/penjualan/retur-grosir", "/penjualan/faktur", `/penjualan/faktur/${invoiceId}`, "/keuangan/piutang",
    "/keuangan/piutang/pembantu", "/laporan/penjual", "/laporan/penjualan-rinci", "/laporan/transaksi-cabang", "/pos/stok", "/"]) revalidatePath(path);
  if (returnId) revalidatePath(`/penjualan/retur-grosir/${returnId}`);
}

/** Simpan Retur Penjualan atas satu faktur grosir. Database menghitung ulang dan mengunci semuanya. */
export async function buatReturGrosir(form: FormData) {
  const db = await createClient();
  const invoiceId = String(form.get("invoice_id") ?? "");
  const back = `/penjualan/retur-grosir/baru?faktur=${encodeURIComponent(invoiceId)}`;
  if (!UUID.test(invoiceId)) redirect(`/penjualan/retur-grosir?error=${encodeURIComponent("Faktur retur tidak valid.")}`);
  const key = String(form.get("draft_key") ?? "");
  const periksa = form.get("tindakan") === "periksa";
  const items = form.getAll("line_id").map(String).flatMap((id) => {
    const qty = Number(String(form.get(`qty_${id}`) ?? "").replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) return [];
    const exp = String(form.get(`exp_${id}`) ?? "").trim();
    return [{ invoice_item_id: id, qty, ...(exp ? { exp_date: exp } : {}) }];
  });
  const warehouse = String(form.get("warehouse_id") ?? "").trim();
  const { data, error } = periksa
    ? await db.rpc("get_wholesale_operation", { p_invoice_id: invoiceId, p_kind: "return", p_request_key: key })
    : await db.rpc("post_wholesale_return", {
      p_request_key: key, p_invoice_id: invoiceId, p_tanggal: String(form.get("tanggal") ?? ""),
      p_warehouse_id: warehouse || null, p_alasan: String(form.get("alasan") ?? "").trim(), p_items: items,
    });
  if (error) redirect(`${back}&error=${encodeURIComponent(error.message)}`);
  if (periksa && !data) redirect(`${back}&error=${encodeURIComponent("Belum ada retur tersimpan untuk formulir ini. Periksa isian lalu simpan.")}`);
  if (!data?.return_id || !data?.journal_id || data.invoice_id !== invoiceId) {
    throw new Error("Retur belum terkonfirmasi. Periksa hasil terakhir sebelum mengirim ulang.");
  }
  segarkan(invoiceId, data.return_id);
  const pesan = Number(data.customer_credit) > 0
    ? "Retur tersimpan. Barang kembali ke gudang; sebagian nilai menjadi kredit pelanggan karena faktur sudah dibayar."
    : "Retur tersimpan. Barang kembali ke gudang dan piutang faktur berkurang.";
  redirect(`/penjualan/retur-grosir/${encodeURIComponent(data.return_id)}?success=${encodeURIComponent(pesan)}${transactionDraftAck(form)}`);
}

/** Batalkan retur (OWNER/FINANCE): stok keluar lagi, jurnal dibalik, piutang/kredit dikembalikan. */
export async function batalReturGrosir(form: FormData) {
  const db = await createClient();
  const returnId = String(form.get("return_id") ?? "");
  const invoiceId = String(form.get("invoice_id") ?? "");
  const back = `/penjualan/retur-grosir/${encodeURIComponent(returnId)}`;
  if (!UUID.test(returnId) || !UUID.test(invoiceId)) redirect(`/penjualan/retur-grosir?error=${encodeURIComponent("Retur tidak valid.")}`);
  const key = String(form.get("draft_key") ?? "");
  const periksa = form.get("tindakan") === "periksa";
  const { data, error } = periksa
    ? await db.rpc("get_wholesale_operation", { p_invoice_id: invoiceId, p_kind: "return-void", p_request_key: key })
    : await db.rpc("void_wholesale_return", {
      p_return_id: returnId, p_expected_revision: Number(form.get("revision")), p_request_key: key,
      p_reason: String(form.get("alasan") ?? "").trim(),
    });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (periksa && !data) redirect(`${back}?error=${encodeURIComponent("Belum ada pembatalan tersimpan untuk formulir ini.")}`);
  if (!data?.reversal_journal_id || data.return_id !== returnId || data.invoice_id !== invoiceId) {
    throw new Error("Pembatalan retur belum terkonfirmasi. Periksa hasil terakhir sebelum mengulang.");
  }
  segarkan(invoiceId, returnId);
  redirect(`${back}?success=${encodeURIComponent("Retur dibatalkan. Barang keluar lagi dari gudang dan jurnalnya dibalik.")}${transactionDraftAck(form)}`);
}
