"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pesanTarikBaris, type Pratinjau } from "@/lib/tarik-baris-pesan";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HasilTarik = { ok: true; pratinjau: Pratinjau; selesai: boolean; replayed?: boolean } | { ok: false; pesan: string };

function bacaMasukan(form: FormData): { invoiceId: string; visitId: string; lines: { invoice_item_id: string }[]; reason: string; key: string } | string {
  const invoiceId = String(form.get("invoice_id") ?? ""); const visitId = String(form.get("visit_id") ?? "");
  const reason = String(form.get("reason") ?? "").trim(); const key = String(form.get("request_key") ?? "").trim();
  const ids = form.getAll("line").map(String);
  if (!uuid.test(invoiceId) || !uuid.test(visitId)) return "Tagihan tidak valid. Muat ulang halaman.";
  if (ids.length === 0 || ids.length > 50 || ids.some((i) => !uuid.test(i)) || new Set(ids).size !== ids.length) return "Pilih minimal satu baris.";
  return { invoiceId, visitId, lines: ids.map((invoice_item_id) => ({ invoice_item_id })), reason, key };
}

/** Pratinjau baca-saja: menjalankan kode yang sama di sub-transaksi yang dibatalkan. Tidak menulis apa pun. */
export async function pratinjauTarikBaris(form: FormData): Promise<HasilTarik> {
  const input = bacaMasukan(form);
  if (typeof input === "string") return { ok: false, pesan: input };
  const db = await createClient();
  const { data, error } = await db.rpc("clinic_owner_invoice_lines_quote", { p_invoice_id: input.invoiceId, p_lines: input.lines });
  if (error || !data) return { ok: false, pesan: pesanTarikBaris(error?.message) };
  return { ok: true, pratinjau: data as Pratinjau, selesai: false };
}

/** Eksekusi: satu RPC atomik, idempoten menurut kunci. Respons hilang aman diulang dengan kunci yang sama. */
export async function tarikBarisLunas(form: FormData): Promise<HasilTarik> {
  const input = bacaMasukan(form);
  if (typeof input === "string") return { ok: false, pesan: input };
  if (input.reason.replace(/\s/g, "").length < 5 || input.reason.length > 500) return { ok: false, pesan: pesanTarikBaris("REASON_REQUIRED: x") };
  if (!input.key || input.key.length > 100) return { ok: false, pesan: "Identitas simpan belum siap. Muat ulang halaman." };
  const db = await createClient();
  const { data, error } = await db.rpc("clinic_owner_remove_invoice_lines", {
    p_invoice_id: input.invoiceId, p_lines: input.lines, p_reason: input.reason, p_request_key: input.key,
  });
  if (error || !data || data.status !== "OK") return { ok: false, pesan: pesanTarikBaris(error?.message) };
  revalidatePath("/", "layout");
  return { ok: true, pratinjau: data as Pratinjau, selesai: true, replayed: data.replayed === true };
}
