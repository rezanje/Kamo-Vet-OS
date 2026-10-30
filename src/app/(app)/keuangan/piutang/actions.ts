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
  const { data: inv, error: invError } = await supabase.from("invoices")
    .select("visit_id, visits(branch_id, inpatient_records(id))").eq("id", invoiceId).maybeSingle();
  if (invError) redirect(`${back}?error=${encodeURIComponent("Tagihan belum dapat dibaca. Muat ulang sebelum menerima uang.")}`);
  if (!inv) redirect(`${back}?error=${encodeURIComponent("Tagihan tidak ditemukan")}`);
  const visit = Array.isArray(inv.visits) ? inv.visits[0] : inv.visits;
  // Uang rawat inap WAJIB lewat kwitansi kunjungan di dalam shift klinik: hanya di sana
  // uangnya muncul pada riwayat DP dan ikut rekonsiliasi laci kasir penerimanya. Layar
  // ini tidak membuat kwitansi, jadi petugas diarahkan ke layar tagihannya.
  const ranap = (visit?.inpatient_records ?? []) as { id: string }[];
  const record = Array.isArray(ranap) ? ranap[0] : ranap;
  if (record?.id) {
    redirect(`/klinik/rawat-inap/${record.id}/tagihan?error=${encodeURIComponent(
      "Pembayaran rawat inap diterima di layar Tagihan rawat inap supaya tercatat sebagai kwitansi dan masuk shift klinik.")}`);
  }
  const kasCode = await kodeAkunBayar(supabase, metode, visit?.branch_id ?? null, accountId);
  const { error } = await supabase.rpc("clinic_receive_invoice_payment", {
    p_invoice_id: invoiceId, p_tanggal: tanggal, p_amount: amount,
    p_metode: metode, p_kas_code: kasCode, p_catatan: catatan,
    p_request_key: requestKey,
  });
  if (error) redirect(`${back}?error=${encodeURIComponent("Pembayaran belum tersimpan. " + error.message)}`);
  redirect(`${back}?success=1${transactionDraftAck(formData)}`);
}
