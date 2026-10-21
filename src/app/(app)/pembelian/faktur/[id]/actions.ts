"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

export async function batalkanPembayaranFaktur(formData: FormData) {
  const supabase = await createClient();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const paymentId = String(formData.get("payment_id") ?? "");
  const back = `/pembelian/faktur/${encodeURIComponent(invoiceId)}`;
  const recovery = formData.get("tindakan") === "periksa";
  const requestKey = String(formData.get("draft_key") ?? "");
  const { data, error } = recovery
    ? await supabase.rpc("get_purchase_payment_cancellation", { p_payment_id: paymentId, p_request_key: requestKey })
    : await supabase.rpc("cancel_purchase_payment", {
      p_payment_id: paymentId, p_expected_revision: Number(formData.get("revision")),
      p_request_key: requestKey, p_reason: String(formData.get("alasan") ?? "").trim(),
    });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (recovery && !data) redirect(`${back}?error=${encodeURIComponent("Belum ada pembatalan terkonfirmasi untuk formulir ini. Periksa rincian sebelum mengirim kembali.")}`);
  if (!data?.cancellation_id || !data?.reversal_journal_id || data.payment_id !== paymentId || data.invoice_id !== invoiceId) {
    throw new Error("Pembatalan belum terkonfirmasi lengkap. Periksa riwayat pembayaran sebelum mengulang.");
  }
  for (const path of [back, "/pembelian/faktur", "/keuangan/hutang", "/pembelian/perintah-bayar", "/pembelian/uang-muka", "/laporan/pembelian", "/pembelian/perintah-bayar", "/"]) revalidatePath(path);
  const ack = transactionDraftAck(formData);
  if (formData.get("tindakan") === "ganti") {
    if (data.order_id) redirect(`/pembelian/perintah-bayar?success=${encodeURIComponent("Pembayaran dibalik. Perintah bayar siap diperiksa dan dibayar kembali.")}${ack}`);
    redirect(`/keuangan/hutang?replace_payment=${encodeURIComponent(paymentId)}&success=${encodeURIComponent("Pembayaran dibalik. Periksa rincian pengganti sebelum menyimpan.")}${ack}`);
  }
  redirect(`${back}?success=${encodeURIComponent("Pembayaran dibatalkan. Saldo hutang dan uang muka sudah dikembalikan.")}${ack}`);
}

export async function batalkanFakturPembelian(formData: FormData) {
  const supabase = await createClient();
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const back = `/pembelian/faktur/${encodeURIComponent(invoiceId)}`;
  const requestKey = String(formData.get("draft_key") ?? "");
  const recovery = formData.get("tindakan") === "periksa";
  const { data, error } = recovery
    ? await supabase.rpc("get_purchase_invoice_cancellation", { p_invoice_id: invoiceId, p_request_key: requestKey })
    : await supabase.rpc("cancel_purchase_invoice", {
      p_invoice_id: invoiceId, p_request_key: requestKey, p_expected_revision: Number(formData.get("revision")),
      p_reason: String(formData.get("alasan") ?? "").trim(), p_tanggal: String(formData.get("tanggal") ?? ""),
    });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data?.reversal_journal_id || data.invoice_id !== invoiceId) throw new Error("Pembatalan belum terkonfirmasi. Periksa hasil terakhir sebelum mengulang.");
  for (const path of [back, "/pembelian/faktur", "/pembelian/faktur/baru", "/keuangan/hutang", "/laporan/pembelian", "/pembelian/perintah-bayar", "/"]) revalidatePath(path);
  const ack = transactionDraftAck(formData);
  if (formData.get("tindakan") === "ganti") redirect(`/pembelian/faktur/${data.po_id ? "baru" : "langsung"}?replace_invoice=${invoiceId}${ack}`);
  redirect(`${back}?success=${encodeURIComponent("Faktur dibatalkan. Nilai stok dan pembukuan sudah dikembalikan; riwayat tetap disimpan.")}${ack}`);
}
