"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { validasiTransfer } from "@/lib/transfer-kas";
import { hariIniWIB } from "@/lib/tanggal";

const BACK = "/kas-bank/transfer";
const gagal = (message: string): never => redirect(`${BACK}?error=${encodeURIComponent(message)}`);

async function simpan(formData: FormData, action: "create" | "edit" | "void") {
  const supabase = await assertRole(BACK, "catatan transfer", action === "create" ? ["OWNER", "ADMIN", "FINANCE"] : ["OWNER"]);
  const key = String(formData.get("draft_key") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  const revisionText = String(formData.get("revision") ?? "");
  const revision = Number(revisionText);
  const reason = String(formData.get("reason") ?? "").trim();
  const fail = (message: string): never => redirect(`${BACK}?${action === "create" ? "" : `${action === "edit" ? "koreksi" : "batal"}=${encodeURIComponent(id)}&`}error=${encodeURIComponent(message)}`);
  const recovery = formData.get("tindakan") === "periksa";
  if (!key || key.length > 120) fail("Identitas simpan belum tersedia. Muat ulang formulir.");
  if (!recovery && action !== "create" && (!id || !/^\d+$/.test(revisionText) || !Number.isSafeInteger(revision) || reason.length < 3 || reason.length > 1000)) fail("Identitas atau alasan koreksi tidak valid.");
  const header = action === "void" ? {} : {
    tanggal: String(formData.get("tanggal") ?? "").trim(),
    from_account_id: String(formData.get("from_account_id") ?? "").trim(),
    to_account_id: String(formData.get("to_account_id") ?? "").trim(),
    jumlah: Number(formData.get("jumlah")), biaya_admin: Number(formData.get("biaya_admin") ?? 0),
    branch_id: String(formData.get("branch_id") ?? "").trim() || null,
    keterangan: String(formData.get("keterangan") ?? "").trim() || null,
  };
  if (!recovery && action !== "void") {
    const h = header as { tanggal: string; from_account_id: string; to_account_id: string; jumlah: number; biaya_admin: number };
    const error = validasiTransfer({ tanggal: h.tanggal, dariId: h.from_account_id, keId: h.to_account_id, jumlah: h.jumlah, biayaAdmin: h.biaya_admin, hariIni: hariIniWIB() });
    if (error) fail(error);
  }
  const { data, error } = recovery
    ? await supabase.rpc("get_cash_transfer_result", { p_request_key: key })
    : await supabase.rpc("mutate_cash_transfer", {
      p_request_key: key, p_action: action, p_transfer_id: action === "create" ? null : id,
      p_expected_revision: action === "create" ? null : revision, p_header: header,
      p_reason: action === "create" ? null : reason,
    });
  if (error) fail(["55P03", "40P01", "40001"].includes(error.code) ? "Catatan sedang diproses atau berubah bersamaan. Periksa hasil terakhir lalu muat ulang sebelum mencoba lagi." : error.message);
  if (!data?.transfer_id || !data?.journal_entry_id || (action !== "create" && (!data?.reversal_journal_id || data.transfer_id !== id)) || (action === "edit" && (!data?.replacement_transfer_id || !data?.replacement_journal_id))) {
    fail("Hasil transfer belum terkonfirmasi lengkap. Isian tetap tersedia; periksa hasil terakhir sebelum mengirim ulang.");
  }
  for (const path of [BACK, "/kas-bank", "/kas-bank/rekening", "/keuangan/jurnal", "/keuangan/rekonsiliasi", "/laporan", "/"]) revalidatePath(path);
  redirect(`${BACK}?success=${action === "void" ? "batal" : action === "edit" ? "koreksi" : "1"}${transactionDraftAck(formData)}`);
}
export async function buatTransfer(formData: FormData) { return simpan(formData, "create"); }
export async function koreksiTransfer(formData: FormData) { return simpan(formData, "edit"); }
export async function batalkanTransfer(formData: FormData) { return simpan(formData, "void"); }

export async function pulihkanTransfer(formData: FormData) {
  const supabase = await assertRole(BACK, "catatan transfer", ["OWNER", "ADMIN", "FINANCE"]);
  const key = String(formData.get("draft_key") ?? "").trim();
  if (!key || key.length > 120) gagal("Identitas simpan tidak valid.");
  const { data, error } = await supabase.rpc("get_cash_transfer_result", { p_request_key: key });
  if (error) gagal(error.message);
  if (!data?.transfer_id || !data?.journal_entry_id || !["create", "edit", "void"].includes(data.action)
    || (data.action !== "create" && !data.reversal_journal_id)
    || (data.action === "edit" && (!data.replacement_transfer_id || !data.replacement_journal_id))) {
    gagal("Belum ada hasil lengkap yang terkonfirmasi. Isian tetap tersedia; tinjau rincian sebelum mengirim ulang.");
  }
  revalidatePath(BACK);
  redirect(`${BACK}?success=${data.action === "void" ? "batal" : data.action === "edit" ? "koreksi" : "1"}${transactionDraftAck(formData)}`);
}
