"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { hariIniWIB } from "@/lib/tanggal";

/** Receipt, advance usage, ledger and invoice status commit in one DB transaction. */
export async function terimaPembayaranJual(form: FormData) {
  const db = await createClient();
  const invoiceId = String(form.get("invoice_id") ?? "").trim();
  const key = String(form.get("draft_key") ?? "").trim();
  const back = "/penjualan/faktur";
  const { data, error } = form.get("tindakan") === "periksa"
    ? await db.rpc("get_wholesale_operation", { p_invoice_id: invoiceId, p_kind: "receipt", p_request_key: key })
    : await db.rpc("receive_wholesale_payment", {
      p_request_key: key, p_invoice_id: invoiceId,
      p_tanggal: String(form.get("tanggal") ?? "") || hariIniWIB(),
      p_amount: Number(form.get("jumlah")), p_metode: String(form.get("metode") ?? "Transfer"),
      p_account_id: String(form.get("account_id") ?? "").trim() || null,
      p_advance_id: String(form.get("advance_id") ?? "").trim() || null,
      p_catatan: String(form.get("catatan") ?? "").trim() || null,
    });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data?.receipt_id || !data?.journal_id || data.invoice_id !== invoiceId) {
    throw new Error("Penerimaan belum terkonfirmasi lengkap. Periksa hasil terakhir sebelum mengirim ulang.");
  }
  for (const path of [back, `/penjualan/faktur/${encodeURIComponent(invoiceId)}`, "/keuangan/piutang", "/keuangan/piutang/pembantu", "/penjualan/uang-muka", "/laporan/penjual", "/"]) revalidatePath(path);
  redirect(`${back}?success=${encodeURIComponent(`Penerimaan ${data.document_no} tercatat.`)}${transactionDraftAck(form)}`);
}
