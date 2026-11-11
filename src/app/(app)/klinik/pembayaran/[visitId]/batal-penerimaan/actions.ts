"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pesanBatalPenerimaan, PESAN_BELUM_TERKONFIRMASI, type HasilBatal } from "@/lib/batal-penerimaan-pesan";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HasilAksiBatal = { ok: true; hasil: HasilBatal } | { ok: false; pesan: string };

/**
 * "Batalkan penerimaan" (Owner, atau peran yang diberi izin eksplisit): satu RPC atomik yang membalik uang yang sudah diterima pada satu
 * tagihan, mengembalikannya ke Belum Lunas dengan nomor yang sama, dan mencatat jejak. Idempoten menurut kunci: respons yang hilang aman
 * diulang dengan kunci yang sama. Otorisasi sebenarnya ada di database; layar hanya menyembunyikan tombolnya.
 */
export async function batalkanPenerimaanKlinik(form: FormData): Promise<HasilAksiBatal> {
  const invoiceId = String(form.get("invoice_id") ?? "").trim();
  const visitId = String(form.get("visit_id") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const key = String(form.get("request_key") ?? "").trim();
  if (!uuid.test(invoiceId) || !uuid.test(visitId)) return { ok: false, pesan: "Tagihan tidak valid. Muat ulang halaman." };
  if (reason.replace(/\s/g, "").length < 3 || reason.length > 500) return { ok: false, pesan: pesanBatalPenerimaan("RECEIPT_INVALID: x") };
  if (!key || key.length > 100) return { ok: false, pesan: "Identitas simpan belum siap. Muat ulang halaman." };
  const db = await createClient();
  const { data, error } = await db.rpc("clinic_cancel_invoice_receipt", { p_invoice_id: invoiceId, p_request_key: key, p_reason: reason });
  if (error) return { ok: false, pesan: pesanBatalPenerimaan(error.message) };
  if (!data || data.status !== "CANCELLED" || data.invoice_id !== invoiceId) return { ok: false, pesan: PESAN_BELUM_TERKONFIRMASI };
  revalidatePath("/", "layout");
  return { ok: true, hasil: data as HasilBatal };
}
