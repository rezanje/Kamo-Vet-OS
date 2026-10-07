"use server";

import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { hariIniWIB } from "@/lib/tanggal";

export async function terimaPelunasan(formData: FormData) {
  const supabase = await createClient();
  const back = "/keuangan/piutang";
  const invoiceId = String(formData.get("invoice_id") ?? "");
  const requestKey = String(formData.get("draft_key") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const metode = String(formData.get("metode") ?? "");
  const tanggal = String(formData.get("tanggal") ?? "") || hariIniWIB();
  const catatan = String(formData.get("catatan") ?? "").trim() || null;
  const accountId = String(formData.get("account_id") ?? "").trim() || null;
  if (!invoiceId || !requestKey || !Number.isFinite(amount) || amount <= 0) {
    redirect(`${back}?error=${encodeURIComponent("Data pembayaran tidak lengkap; muat ulang halaman")}`);
  }
  const { data: inv } = await supabase.from("invoices")
    .select("visit_id, visits(branch_id)").eq("id", invoiceId).maybeSingle();
  if (!inv) redirect(`${back}?error=${encodeURIComponent("Tagihan tidak ditemukan")}`);
  const visit = Array.isArray(inv.visits) ? inv.visits[0] : inv.visits;
  const kasCode = await kodeAkunBayar(supabase, metode, visit?.branch_id ?? null, accountId);
  const { error } = await supabase.rpc("clinic_receive_invoice_payment", {
    p_invoice_id: invoiceId, p_tanggal: tanggal, p_amount: amount,
    p_metode: metode, p_kas_code: kasCode, p_catatan: catatan,
    p_request_key: requestKey,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent("Pembayaran belum tersimpan. " + error.message)}`);
  redirect(`${back}?success=1${transactionDraftAck(formData)}`);
}
