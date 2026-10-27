"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";

/** P08: OWNER cancels a posted goods receipt. Safety checks and all effects live in one DB transaction. */
export async function batalkanPenerimaan(formData: FormData) {
  const supabase = await createClient();
  const receiptId = String(formData.get("receipt_id") ?? "");
  const back = `/pembelian/penerimaan/${encodeURIComponent(receiptId)}`;
  const { data, error } = await supabase.rpc("cancel_goods_receipt", {
    p_receipt_id: receiptId,
    p_request_key: String(formData.get("draft_key") ?? ""),
    p_reason: String(formData.get("alasan") ?? "").trim(),
    p_tanggal: String(formData.get("tanggal") ?? ""),
  });
  if (error) redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  if (!data || data.receipt_id !== receiptId) throw new Error("Pembatalan belum terkonfirmasi. Muat ulang halaman sebelum mengulang.");
  for (const path of [back, "/pembelian/penerimaan", "/pembelian", `/pembelian/${data.po_id}`, "/pembelian/faktur/baru", "/keuangan/hutang", "/laporan/pembelian", "/"]) revalidatePath(path);
  const pesan = data.already_cancelled
    ? "Penerimaan ini sudah dibatalkan sebelumnya. Tidak ada perubahan baru."
    : "Penerimaan dibatalkan. Stok dan jurnal persediaan sudah dibalik, sisa PO dibuka lagi; dokumen asli tetap tersimpan.";
  redirect(`${back}?success=${encodeURIComponent(pesan)}${transactionDraftAck(formData)}`);
}
