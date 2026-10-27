"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** J03: refund per baris invoice klinik. Satu RPC atomik; respons hilang dipulihkan dengan kunci yang sama. */
export async function buatRefundKlinik(form: FormData) {
  const visitId = String(form.get("visit_id") ?? "");
  const invoiceId = String(form.get("invoice_id") ?? "");
  const key = String(form.get("request_key") ?? "");
  const back = `/klinik/pembayaran/${uuid.test(visitId) ? visitId : ""}`;
  const fail = (msg: string): never => redirect(`${back}?error=${encodeURIComponent(msg)}`);
  if (!uuid.test(visitId) || !uuid.test(invoiceId) || !key) fail("Pilih invoice dan tunggu identitas simpan. Muat ulang bila diperlukan.");
  const db = await createClient();
  let response;
  if (form.get("tindakan") === "periksa") {
    try { response = await db.rpc("get_clinic_refund_result", { p_request_key: key }); }
    catch { fail("Hasil refund belum terkonfirmasi. Tidak ada posting baru."); }
  } else {
    let items: unknown;
    try { items = JSON.parse(String(form.get("items") ?? "[]")); } catch { fail("Rincian refund tidak valid."); }
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) fail("Isi qty refund minimal satu baris.");
    const method = String(form.get("refund_method") ?? "");
    if (!["Tunai", "Transfer"].includes(method)) fail("Pilih payout Tunai atau Transfer.");
    const header = {
      tanggal: String(form.get("tanggal") ?? "") || hariIniWIB(),
      keterangan: String(form.get("keterangan") ?? ""),
      refund_method: method,
      destination: method === "Transfer" ? {
        bank: String(form.get("refund_bank") ?? "").trim(),
        account: String(form.get("refund_account") ?? "").trim(),
        name: String(form.get("refund_name") ?? "").trim(),
      } : null,
    };
    try { response = await db.rpc("post_clinic_refund", { p_invoice: invoiceId, p_request_key: key, p_header: header, p_items: items }); }
    catch { fail("Respons refund belum terkonfirmasi. Periksa hasil terakhir sebelum mencoba lagi."); }
  }
  if (!response) return fail("Hasil refund belum terkonfirmasi. Periksa daftar refund sebelum mencoba lagi.");
  const { data, error } = response;
  if (error) fail(["P0001", "42501", "22023"].includes(error.code) ? error.message : "Respons refund belum terkonfirmasi. Periksa hasil terakhir.");
  if (!data || !uuid.test(data.refund_request_id) || !["pending", "diproses", "selesai", "batal"].includes(data.status)
    || (data.status === "selesai" && (!uuid.test(data.document_id) || typeof data.document_no !== "string" || !data.document_no.trim())))
    fail("Hasil refund belum terkonfirmasi. Periksa daftar refund sebelum mencoba lagi.");
  revalidatePath("/", "layout");
  const message = data.status === "selesai"
    ? `Refund ${data.document_no} tercatat. Uang dikembalikan, jurnal dan stok (obat layak jual) sudah diposting.`
    : data.status === "batal" ? "Permintaan refund dibatalkan; tidak ada posting."
    : "Permintaan refund transfer diterima finance. Jurnal dan stok belum diposting sampai transfer dicatat selesai. Jangan bayar tunai untuk permintaan yang sama.";
  const scope = `clinic-refund:${invoiceId}`;
  redirect(`${back}?success=${encodeURIComponent(message)}&request_scope=${encodeURIComponent(scope)}&request_done=${encodeURIComponent(key)}`);
}

export async function periksaRefundKlinik(form: FormData) { form.set("tindakan", "periksa"); return buatRefundKlinik(form); }
