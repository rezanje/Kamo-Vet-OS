"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  ALASAN_BATAL_MAX, ALASAN_BATAL_MIN, PESAN_BATAL_BELUM_TERKONFIRMASI, pesanBatalTagihan, type HasilBatalTagihan,
} from "@/lib/batal-tagihan-klinik";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HasilAksiBatalTagihan = { ok: true; hasil: HasilBatalTagihan } | { ok: false; pesan: string };

/**
 * B2 "Batalkan tagihan" klinik (void murni): satu RPC atomik clinic_void_invoice. Idempoten menurut kunci (respons yang hilang aman diulang
 * dengan kunci yang sama). Otorisasi, periode, uang, stok, DP, dan poin diputuskan database; layar hanya menyembunyikan tombolnya.
 */
export async function batalkanTagihanKlinik(form: FormData): Promise<HasilAksiBatalTagihan> {
  const invoiceId = String(form.get("invoice_id") ?? "").trim();
  const visitId = String(form.get("visit_id") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const key = String(form.get("request_key") ?? "").trim();
  if (!uuid.test(invoiceId) || !uuid.test(visitId)) return { ok: false, pesan: "Tagihan tidak valid. Muat ulang halaman." };
  if (reason.replace(/\s/g, "").length < ALASAN_BATAL_MIN || reason.length > ALASAN_BATAL_MAX) return { ok: false, pesan: pesanBatalTagihan("BATAL_TAGIHAN_INVALID: x") };
  if (!key || key.length > 100) return { ok: false, pesan: "Identitas simpan belum siap. Muat ulang halaman." };
  const db = await createClient();
  const { data, error } = await db.rpc("clinic_void_invoice", { p_invoice_id: invoiceId, p_request_key: key, p_reason: reason });
  if (error) return { ok: false, pesan: pesanBatalTagihan(error.message) };
  if (!data || data.status !== "VOIDED" || data.invoice_id !== invoiceId) return { ok: false, pesan: PESAN_BATAL_BELUM_TERKONFIRMASI };
  revalidatePath("/", "layout");
  return { ok: true, hasil: data as HasilBatalTagihan };
}
