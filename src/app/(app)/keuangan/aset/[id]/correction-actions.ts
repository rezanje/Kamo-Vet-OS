"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import type { AssetCorrectionPreview } from "@/lib/asset-correction";

function input(form: FormData) {
  return {
    p_asset_id: String(form.get("id") ?? ""),
    p_expected_revision: Number(form.get("revision")),
    p_tanggal: String(form.get("tanggal") ?? ""),
    p_harga: Number(form.get("harga")),
    p_reason: String(form.get("alasan") ?? ""),
  };
}

export async function previewKoreksiAset(form: FormData): Promise<AssetCorrectionPreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_fixed_asset_correction", input(form));
  if (error || !data || typeof data.allowed !== "boolean" || !Array.isArray(data.blockers)) {
    return { allowed: false, blockers: [error?.message ?? "Pratinjau belum terkonfirmasi. Coba lagi."] };
  }
  return data as AssetCorrectionPreview;
}

export async function koreksiPembelianAset(form: FormData) {
  const values = input(form);
  const back = `/keuangan/aset/${encodeURIComponent(values.p_asset_id)}`;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  const key = String(form.get("draft_key") ?? "");
  if (!key || key.length > 120) fail("Identitas koreksi tidak tersedia. Muat ulang formulir.");
  const supabase = await createClient();
  const recovery = form.get("tindakan") === "periksa";
  const { data, error } = recovery
    ? await supabase.rpc("get_fixed_asset_correction_result", { p_asset_id: values.p_asset_id, p_request_key: key })
    : await supabase.rpc("correct_fixed_asset_purchase", { ...values, p_request_key: key });
  if (error) fail(error.message);
  if (!data?.correction_id || !data.reversal_journal_id || !data.replacement_journal_id || data.asset_id !== values.p_asset_id) {
    fail("Hasil koreksi belum terkonfirmasi. Periksa hasil terakhir sebelum mengirim ulang.");
  }
  redirect(`${back}?success=${encodeURIComponent("Koreksi aset tersimpan beserta alasan dan jurnal pembalik/pengganti.")}${transactionDraftAck(form)}`);
}
