"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pesanRefundUangMuka } from "@/lib/uang-muka-refund";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HasilAjukan = { ok: true; noRefund: string; replayed: boolean } | { ok: false; pesan: string };

/** Jumlah ditulis orang Indonesia: "30.000", "30000", "1000,5". Maksimal 2 desimal; hasil null bila tidak valid. */
function bacaJumlah(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$|^\d+(\.\d{1,2})?$/.test(t)) return null;
  const angka = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const n = Number(angka);
  if (!Number.isFinite(n) || n <= 0 || Math.round(n * 100) / 100 !== n) return null;
  return n;
}

/** Pengajuan "Kembalikan saldo uang muka": satu RPC atomik (mencadangkan jumlahnya), idempoten menurut kunci. Tidak ada uang yang bergerak di sini. */
export async function ajukanRefundUangMuka(form: FormData): Promise<HasilAjukan> {
  const advanceId = String(form.get("advance_id") ?? ""); const key = String(form.get("request_key") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const bank = String(form.get("bank") ?? "").trim(), account = String(form.get("account") ?? "").trim(), name = String(form.get("holder") ?? "").trim();
  const amount = bacaJumlah(String(form.get("amount") ?? ""));
  if (!uuid.test(advanceId)) return { ok: false, pesan: "Uang muka tidak valid. Muat ulang halaman." };
  if (amount === null) return { ok: false, pesan: pesanRefundUangMuka("AMOUNT_INVALID: x") };
  if (reason.replace(/\s/g, "").length < 5 || reason.length > 500) return { ok: false, pesan: pesanRefundUangMuka("REASON_REQUIRED: x") };
  if (bank.length < 1 || bank.length > 80 || name.length < 1 || name.length > 120 || !/^[A-Za-z0-9 -]{3,40}$/.test(account)) return { ok: false, pesan: pesanRefundUangMuka("DESTINATION_INVALID: x") };
  if (!key || key.length > 100) return { ok: false, pesan: pesanRefundUangMuka("KEY_REQUIRED: x") };
  const db = await createClient();
  const { data, error } = await db.rpc("clinic_advance_refund_request", { p_advance_id: advanceId, p_amount: amount, p_reason: reason, p_destination: { bank, account, name }, p_request_key: key });
  if (error || !data) return { ok: false, pesan: pesanRefundUangMuka(error?.message) };
  if (data.status !== "pending" || typeof data.no_refund !== "string" || !data.no_refund || !uuid.test(String(data.refund_id ?? ""))) return { ok: false, pesan: pesanRefundUangMuka(null) };
  revalidatePath("/", "layout");
  return { ok: true, noRefund: data.no_refund, replayed: data.replayed === true };
}
