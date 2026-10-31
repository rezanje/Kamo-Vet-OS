"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * J02 klinik: koreksi Tunai <-> Transfer satu bagian pembayaran invoice (Owner/Finance).
 * Satu RPC atomik membuat jurnal koreksi; kunci yang sama aman diulang bila respons hilang.
 */
export async function koreksiMetodeBayarKlinik(form: FormData) {
  const visitId = String(form.get("visitId") ?? "");
  const invoiceId = String(form.get("invoiceId") ?? "");
  const paymentText = String(form.get("paymentId") ?? "");
  const revisionText = String(form.get("revision") ?? "");
  const revision = Number(revisionText);
  const key = String(form.get("requestKey") ?? "");
  const reason = String(form.get("alasan") ?? "").trim();
  const method = String(form.get("metode") ?? "");
  if (!uuid.test(visitId) || !uuid.test(invoiceId) || (paymentText !== "" && !uuid.test(paymentText))
    || !revisionText.trim() || !Number.isSafeInteger(revision) || revision < 0
    || !key.trim() || key.length > 120 || reason.length < 3 || reason.length > 1000
    || (method !== "Tunai" && method !== "Transfer")) {
    throw new Error("Identitas, alasan atau metode koreksi tidak valid. Muat ulang lalu coba lagi.");
  }
  const paymentId = paymentText === "" ? null : paymentText;
  const db = await createClient();
  const { data, error } = await db.rpc("correct_clinic_invoice_payment", {
    p_invoice_id: invoiceId, p_payment_id: paymentId, p_expected_revision: revision,
    p_request_key: key, p_reason: reason, p_new_method: method,
  });
  if (error || data?.invoice_id !== invoiceId || (data?.payment_id ?? null) !== paymentId
    || data?.revision !== revision + 1 || !data?.audit_id) {
    throw new Error(error?.message ?? "Hasil koreksi belum terkonfirmasi. Coba lagi dengan formulir yang sama.");
  }
  revalidatePath("/", "layout");
  const scope = `clinic-payment:${invoiceId}:${paymentId ?? "langsung"}:${revision}`;
  redirect(`/klinik/pembayaran/${visitId}?success=koreksi-metode&draft_scope=${encodeURIComponent(scope)}&draft_done=${encodeURIComponent(key)}`);
}
