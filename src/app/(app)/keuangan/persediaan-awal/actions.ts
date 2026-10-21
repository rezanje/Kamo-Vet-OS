"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { InventoryAccountingReport, InventoryAccountingPreviewResult, InventoryAccountingPostResult } from "./types";

async function requireOwner() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error("Sesi login kedaluwarsa.");
  const { data: profile, error } = await supabase.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== "OWNER" || profile.is_active !== true) throw new Error("Hanya OWNER aktif yang dapat meninjau dan memposting persediaan awal.");
  return supabase;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function previewInventoryAccounting(runId: string, equityAccountId: string): Promise<InventoryAccountingPreviewResult> {
  try {
    const supabase = await requireOwner();
    if (!uuid.test(runId) || !uuid.test(equityAccountId)) throw new Error("Pilih batch dan akun ekuitas secara eksplisit.");
    const { data, error } = await supabase.rpc("preview_accurate_inventory_accounting", { p_run_id: runId, p_equity_account_id: equityAccountId });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Laporan rekonsiliasi tidak tersedia.");
    return { ok: true, report: data as InventoryAccountingReport };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Preview persediaan gagal dimuat." };
  }
}

export async function postInventoryAccounting(input: { report: InventoryAccountingReport; reason: string; confirmed: boolean }): Promise<InventoryAccountingPostResult> {
  try {
    const supabase = await requireOwner();
    if (!input.confirmed || input.reason.trim().length < 10 || input.reason.trim().length > 1000) throw new Error("Konfirmasi rincian dan isi alasan audit 10–1.000 karakter.");
    const { report } = input;
    if (report.status !== "previewed" || !report.can_post || report.blockers.length || !report.equity_account || !uuid.test(report.run_id) || !uuid.test(report.equity_account.id)) {
      throw new Error("Batch ini tidak dapat diposting. Tinjau laporan dan keputusan keuangan yang diperlukan.");
    }
    const { data, error } = await supabase.rpc("post_accurate_inventory_accounting", {
      p_run_id: report.run_id, p_equity_account_id: report.equity_account.id, p_expected: report, p_reason: input.reason.trim(),
    });
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Hasil posting belum diterima. Periksa laporan batch sebelum mencoba kembali.");
    for (const path of ["/keuangan/persediaan-awal", "/keuangan/neraca", "/keuangan/buku-besar", "/pos/stok", "/pos/sku/impor"]) revalidatePath(path);
    return { ok: true, receipt: data };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : "Hasil posting belum dapat dipastikan. Periksa laporan batch." };
  }
}
