"use server";

import { redirect } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { validasiTransfer } from "@/lib/transfer-kas";
import { hariIniWIB } from "@/lib/tanggal";

const BACK = "/kas-bank/transfer";
const gagal = (message: string): never => redirect(`${BACK}?error=${encodeURIComponent(message)}`);

async function simpan(formData: FormData, action: "create" | "edit" | "void") {
  const supabase = await assertRole(BACK, "transfer bank", action === "edit" ? ["OWNER"] : ["OWNER", "ADMIN", "FINANCE"]);
  const key = String(formData.get("draft_key") ?? "").trim();
  const id = String(formData.get("id") ?? "").trim();
  const revisionText = String(formData.get("revision") ?? "");
  const revision = Number(revisionText);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!key || key.length > 120) gagal("Identitas simpan belum tersedia. Muat ulang formulir.");
  if (action !== "create" && (!id || !/^\d+$/.test(revisionText) || !Number.isSafeInteger(revision) || reason.length < 3 || reason.length > 1000)) gagal("Identitas atau alasan koreksi tidak valid.");
  const header = action === "void" ? {} : {
    tanggal: String(formData.get("tanggal") ?? "").trim(),
    from_account_id: String(formData.get("from_account_id") ?? "").trim(),
    to_account_id: String(formData.get("to_account_id") ?? "").trim(),
    jumlah: Number(formData.get("jumlah")), biaya_admin: Number(formData.get("biaya_admin") ?? 0),
    branch_id: String(formData.get("branch_id") ?? "").trim() || null,
    keterangan: String(formData.get("keterangan") ?? "").trim() || null,
  };
  if (action !== "void") {
    const h = header as { tanggal: string; from_account_id: string; to_account_id: string; jumlah: number; biaya_admin: number };
    const error = validasiTransfer({ tanggal: h.tanggal, dariId: h.from_account_id, keId: h.to_account_id, jumlah: h.jumlah, biayaAdmin: h.biaya_admin, hariIni: hariIniWIB() });
    if (error) gagal(error);
  }
  const { data, error } = await supabase.rpc("mutate_cash_transfer", {
    p_request_key: key, p_action: action, p_transfer_id: action === "create" ? null : id,
    p_expected_revision: action === "create" ? null : revision, p_header: header,
    p_reason: action === "create" ? null : reason,
  });
  if (error || !data?.transfer_id) gagal(error?.message ?? "Hasil transfer belum terkonfirmasi. Isian tetap tersedia.");
  redirect(`${BACK}?success=${action === "void" ? "batal" : action === "edit" ? "koreksi" : "1"}${transactionDraftAck(formData)}`);
}
export async function buatTransfer(formData: FormData) { return simpan(formData, "create"); }
export async function koreksiTransfer(formData: FormData) { return simpan(formData, "edit"); }
export async function batalkanTransfer(formData: FormData) { return simpan(formData, "void"); }
