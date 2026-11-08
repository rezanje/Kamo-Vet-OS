"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { muatanKomponen, pesanBmhpOwner, type KomponenInput, type PratinjauBmhp } from "@/lib/bmhp-owner";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HasilBmhp = { ok: true; pratinjau: PratinjauBmhp; replayed?: boolean } | { ok: false; pesan: string };

type Masukan = { mode: "pending" | "tagihan"; visitId: string; recordId: string; targetId: string; snapshot: string; reason: string; key: string; components: { item_id: string; qty: number; unit?: string }[] };

function baca(form: FormData, perluAlasan: boolean): Masukan | string {
  const mode = String(form.get("mode") ?? "") === "tagihan" ? "tagihan" : "pending";
  const visitId = String(form.get("visit_id") ?? ""); const recordId = String(form.get("record_id") ?? ""); const targetId = String(form.get("target_id") ?? "");
  const snapshot = String(form.get("snapshot") ?? ""); const reason = String(form.get("reason") ?? "").trim(); const key = String(form.get("request_key") ?? "").trim();
  if (!uuid.test(visitId) || !uuid.test(targetId) || (mode === "pending" && (!uuid.test(recordId) || snapshot.length < 8 || snapshot.length > 200))) return "Baris tidak valid. Muat ulang halaman.";
  let rows: KomponenInput[];
  try { rows = JSON.parse(String(form.get("components") ?? "[]")) as KomponenInput[]; } catch { return "Daftar bahan tidak terbaca. Muat ulang halaman."; }
  if (!Array.isArray(rows) || rows.length > 50 || rows.some((r) => !r || typeof r.item_id !== "string" || !uuid.test(r.item_id))) return "Daftar bahan tidak valid.";
  const payload = muatanKomponen(rows);
  if (!payload.ok) return payload.pesan;
  if (perluAlasan) {
    if (reason.replace(/\s/g, "").length < 5 || reason.length > 500) return pesanBmhpOwner("REASON_REQUIRED: x");
    if (!key || key.length > 100) return "Identitas simpan belum siap. Muat ulang halaman.";
  }
  return { mode, visitId, recordId, targetId, snapshot, reason, key, components: payload.components };
}

/** Pratinjau baca-saja: kode yang sama dijalankan di sub-transaksi yang dibatalkan. Tidak menulis apa pun. */
export async function pratinjauBmhp(form: FormData): Promise<HasilBmhp> {
  const m = baca(form, false);
  if (typeof m === "string") return { ok: false, pesan: m };
  const db = await createClient();
  const { data, error } = m.mode === "pending"
    ? await db.rpc("clinic_owner_cart_bmhp_quote", { p_record_id: m.recordId, p_visit_id: m.visitId, p_prescription_item_id: m.targetId, p_components: m.components, p_snapshot: m.snapshot })
    : await db.rpc("clinic_owner_invoiced_bmhp_quote", { p_invoice_item_id: m.targetId, p_components: m.components });
  if (error || !data) return { ok: false, pesan: pesanBmhpOwner(error?.message) };
  return { ok: true, pratinjau: data as PratinjauBmhp };
}

/** Simpan: satu RPC atomik, idempoten menurut kunci. Respons hilang aman diulang dengan kunci yang sama. */
export async function simpanBmhp(form: FormData): Promise<HasilBmhp> {
  const m = baca(form, true);
  if (typeof m === "string") return { ok: false, pesan: m };
  const db = await createClient();
  const { data, error } = m.mode === "pending"
    ? await db.rpc("clinic_owner_correct_cart_bmhp", { p_record_id: m.recordId, p_visit_id: m.visitId, p_prescription_item_id: m.targetId, p_components: m.components, p_reason: m.reason, p_request_key: m.key, p_snapshot: m.snapshot })
    : await db.rpc("clinic_owner_correct_invoiced_bmhp", { p_invoice_item_id: m.targetId, p_components: m.components, p_reason: m.reason, p_request_key: m.key });
  if (error || !data || (data as { status?: string }).status !== "OK") return { ok: false, pesan: pesanBmhpOwner(error?.message) };
  revalidatePath("/", "layout");
  return { ok: true, pratinjau: data as PratinjauBmhp, replayed: (data as { replayed?: boolean }).replayed === true };
}
