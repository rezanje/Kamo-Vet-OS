"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

export async function koreksiFakturGrosir(form: FormData) {
  const db = await createClient();
  const invoiceId = String(form.get("invoice_id") ?? "");
  const back = `/penjualan/faktur/${encodeURIComponent(invoiceId)}`;
  const key = String(form.get("draft_key") ?? "");
  const action = String(form.get("tindakan") ?? "");
  const { data, error } = action === "periksa"
    ? await db.rpc("get_wholesale_operation", { p_invoice_id: invoiceId, p_kind: "correction", p_request_key: key })
    : await db.rpc("correct_wholesale_invoice", {
      p_invoice_id: invoiceId, p_expected_revision: Number(form.get("revision")), p_request_key: key,
      p_action: action, p_reason: String(form.get("alasan") ?? "").trim(),
      p_header: action === "cancel" ? { tanggal: String(form.get("tanggal") ?? "") } : {
        tanggal: String(form.get("tanggal") ?? ""), jatuh_tempo: String(form.get("jatuh_tempo") ?? ""),
        catatan: String(form.get("catatan") ?? "").trim() || null,
        items: form.getAll("line_id").map(id => ({ id: String(id), harga: Number(form.get(`harga_${id}`)) })),
      },
    });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data?.correction_id || !data?.reversal_journal_id || data.invoice_id !== invoiceId) {
    throw new Error("Koreksi belum terkonfirmasi. Periksa hasil terakhir sebelum mengirim ulang.");
  }
  for (const path of [back, "/penjualan/faktur", "/penjualan/pesanan", "/keuangan/piutang", "/keuangan/piutang/pembantu", "/laporan/penjual", "/penjualan/komisi", "/laporan/operasional-penjualan", "/"]) revalidatePath(path);
  revalidatePath("/penjualan/pesanan/[id]", "page");
  const target = data.replacement_id ? `/penjualan/faktur/${encodeURIComponent(data.replacement_id)}` : back;
  revalidatePath(target);
  redirect(`${target}?success=${encodeURIComponent("Koreksi tersimpan. Pembayaran dan pengiriman fisik tetap tercatat; periksa rincian kredit pelanggan bila ada.")}${transactionDraftAck(form)}`);
}
