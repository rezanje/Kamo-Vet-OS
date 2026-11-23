"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { hariIniWIB } from "@/lib/tanggal";
import { denganTampil } from "@/lib/report-gate";

/** Receipt, advance usage, ledger and invoice status commit in one DB transaction. */
export async function terimaPembayaranJual(form: FormData) {
  const db = await createClient();
  const invoiceId = String(form.get("invoice_id") ?? "").trim();
  const key = String(form.get("draft_key") ?? "").trim();
  const back = "/penjualan/faktur";
  // Cabang penerima uang (permintaan Anisa, 23 Nov 2026): kas per cabang. Hanya dikirim bila beda dari cabang
  // faktur; sama / form lama tanpa isian ini = panggilan lama persis (cabang faktur).
  const pilihan = String(form.get("branch_id") ?? "").trim() || null;
  const cabangFaktur = String(form.get("invoice_branch_id") ?? "").trim() || null;
  const cabang = form.has("branch_id") && pilihan !== cabangFaktur ? pilihan : undefined;
  const { data, error } = form.get("tindakan") === "periksa"
    ? await db.rpc("get_wholesale_operation", { p_invoice_id: invoiceId, p_kind: "receipt", p_request_key: key })
    : await db.rpc("receive_wholesale_payment", {
      p_request_key: key, p_invoice_id: invoiceId,
      p_tanggal: String(form.get("tanggal") ?? "") || hariIniWIB(),
      p_amount: Number(form.get("jumlah")), p_metode: String(form.get("metode") ?? "Transfer"),
      p_account_id: String(form.get("account_id") ?? "").trim() || null,
      p_advance_id: String(form.get("advance_id") ?? "").trim() || null,
      p_catatan: String(form.get("catatan") ?? "").trim() || null,
      ...(cabang === undefined ? {} : { p_branch_id: cabang }),
    });
  // A1 (meeting 12 Nov 2026): kembali ke daftar yang sudah ditampilkan (tampil=1).
  if (error) redirect(denganTampil(`${back}?error=${encodeURIComponent(error.message)}`));
  if (!data?.receipt_id || !data?.journal_id || data.invoice_id !== invoiceId
    || (form.get("tindakan") !== "periksa" && cabang && data.branch_id !== cabang)) {
    throw new Error("Penerimaan belum terkonfirmasi lengkap. Periksa hasil terakhir sebelum mengirim ulang.");
  }
  for (const path of [back, `/penjualan/faktur/${encodeURIComponent(invoiceId)}`, "/keuangan/piutang", "/keuangan/piutang/pembantu", "/penjualan/uang-muka", "/laporan/penjual", "/"]) revalidatePath(path);
  redirect(denganTampil(`${back}?success=${encodeURIComponent(`Penerimaan ${data.document_no} tercatat.`)}${transactionDraftAck(form)}`));
}
