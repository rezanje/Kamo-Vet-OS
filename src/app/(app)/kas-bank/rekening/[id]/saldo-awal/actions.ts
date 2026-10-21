"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import type { MonetaryOpeningPreview } from "@/lib/monetary-opening";

const BACK = "/kas-bank/rekening";
const value = (f: FormData, key: string) => String(f.get(key) ?? "").trim();

export async function previewMonetaryOpening(formData: FormData): Promise<{ preview?: MonetaryOpeningPreview; error?: string }> {
  const supabase = await assertRole(BACK, "saldo awal moneter", ["OWNER"]);
  const { data, error } = await supabase.rpc("preview_monetary_opening", {
    p_account_id: value(formData, "account_id"), p_new_amount: value(formData, "amount"), p_reason: value(formData, "reason"),
  });
  if (error || !data) return { error: error?.message ?? "Dampak saldo awal belum dapat diperiksa. Coba lagi." };
  return { preview: data as MonetaryOpeningPreview };
}

export async function correctMonetaryOpening(formData: FormData) {
  const supabase = await assertRole(BACK, "saldo awal moneter", ["OWNER"]);
  const accountId = value(formData, "account_id");
  const back = `${BACK}/${encodeURIComponent(accountId)}/saldo-awal`;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  const key = value(formData, "draft_key");
  if (!key || key.length > 120) fail("Identitas koreksi belum tersedia. Muat ulang formulir.");
  if (value(formData, "intent") === "recover") {
    const { data, error } = await supabase.rpc("get_monetary_opening_result", { p_account_id: accountId, p_request_key: key });
    if (error || !data?.correction_id) fail(error?.message ?? "Permintaan belum tercatat. Periksa preview sebelum mencoba kembali.");
  } else {
    let preview: unknown;
    try { preview = JSON.parse(value(formData, "preview")); } catch { fail("Periksa preview dampak sebelum menyimpan."); }
    if (!preview || Array.isArray(preview) || typeof preview !== "object") fail("Periksa preview dampak sebelum menyimpan.");
    const { data, error } = await supabase.rpc("correct_monetary_opening", {
      p_account_id: accountId, p_new_amount: value(formData, "amount"), p_reason: value(formData, "reason"),
      p_preview: preview, p_request_key: key,
    });
    if (error || !data?.correction_id || !data?.replacement_entry_id) fail(error?.message ?? "Koreksi belum terkonfirmasi. Isian tetap tersedia; periksa hasil sebelum mencoba kembali.");
  }
  revalidatePath("/", "layout");
  redirect(`${back}?success=${encodeURIComponent("Koreksi saldo awal terkonfirmasi. Riwayat dan jurnal pembalik tetap tersimpan.")}${transactionDraftAck(formData)}`);
}
