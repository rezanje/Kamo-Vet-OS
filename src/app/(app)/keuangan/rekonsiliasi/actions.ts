"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { hariIniWIB } from "@/lib/tanggal";

const BACK = "/keuangan/rekonsiliasi";
async function simpan(formData: FormData, action: "create" | "edit" | "void") {
  const supabase = await assertRole(BACK, "rekonsiliasi bank", action === "create" ? ["OWNER", "ADMIN", "FINANCE"] : ["OWNER"]);
  const key = String(formData.get("draft_key") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  const revisionText = String(formData.get("revision") ?? "");
  const revision = Number(revisionText);
  const reason = String(formData.get("reason") ?? "").trim();
  const back = action === "create" || !/^[0-9a-f-]{36}$/i.test(id) ? BACK : `${BACK}/${id}`;
  const fail = (message: string): never => redirect(`${back}?error=${encodeURIComponent(message)}`);
  if (!key || key.length > 120) fail("Identitas simpan belum tersedia. Muat ulang formulir.");
  if (action !== "create" && (!id || !/^\d+$/.test(revisionText) || !Number.isSafeInteger(revision) || reason.length < 3 || reason.length > 1000)) fail("Identitas atau alasan koreksi tidak valid.");
  const header = action === "void" ? {} : {
    account_id: String(formData.get("account_id") ?? "").trim(),
    tanggal: String(formData.get("tanggal") ?? "").trim() || hariIniWIB(),
    saldo_bank: Number(formData.get("saldo_bank") ?? 0),
    biaya_adm: Number(formData.get("biaya_adm") ?? 0),
    bunga: Number(formData.get("bunga") ?? 0),
    catatan: String(formData.get("catatan") ?? "").trim() || null,
  };
  if (action !== "void") {
    const h = header as { account_id: string; tanggal: string; saldo_bank: number; biaya_adm: number; bunga: number };
    if (!h.account_id || !/^\d{4}-\d{2}-\d{2}$/.test(h.tanggal) || h.tanggal > hariIniWIB() || ![h.saldo_bank, h.biaya_adm, h.bunga].every(Number.isFinite) || h.biaya_adm < 0 || h.bunga < 0) fail("Rekening, tanggal atau nilai rekonsiliasi tidak valid.");
  }
  const { data, error } = await supabase.rpc("mutate_bank_reconciliation", {
    p_request_key: key, p_action: action, p_id: action === "create" ? null : id,
    p_expected_revision: action === "create" ? null : revision, p_header: header,
    p_reason: action === "create" ? null : reason,
  });
  if (error && ["40P01", "55P03", "57014"].includes(error.code)) fail("Pembukuan sedang dipakai proses lain. Isian tetap tersedia; coba simpan lagi.");
  if (error || !data?.reconciliation_id) fail(error?.message ?? "Hasil rekonsiliasi belum terkonfirmasi. Isian tetap tersedia.");
  redirect(`${BACK}/${data.reconciliation_id}?success=${action}${transactionDraftAck(formData)}`);
}
export async function prosesRekonsiliasi(formData: FormData) { return simpan(formData, "create"); }
export async function koreksiRekonsiliasi(formData: FormData) { return simpan(formData, "edit"); }
export async function batalkanRekonsiliasi(formData: FormData) { return simpan(formData, "void"); }

export async function pulihkanRekonsiliasi(formData: FormData) {
  const supabase = await assertRole(BACK, "rekonsiliasi bank", ["OWNER", "ADMIN", "FINANCE"]);
  const key = String(formData.get("draft_key") ?? "");
  const scope = String(formData.get("draft_scope") ?? "");
  if (!key || key.length > 120 || !/^bank-reconciliation-(create|(?:edit|void)-[0-9a-f-]{36}-\d+)$/i.test(scope)) redirect(`${BACK}?error=${encodeURIComponent("Identitas pemeriksaan tidak valid.")}`);
  const { data, error } = await supabase.rpc("get_bank_reconciliation_result", { p_request_key: key });
  if (error || !data?.reconciliation_id) redirect(`${BACK}?error=${encodeURIComponent(error?.message ?? "Hasil belum tercatat. Isian lama tetap disimpan; periksa formulir sebelum mengirim ulang.")}`);
  redirect(`${BACK}/${data.reconciliation_id}?success=recovered${transactionDraftAck(formData)}`);
}
