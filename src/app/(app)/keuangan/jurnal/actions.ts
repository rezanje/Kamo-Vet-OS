"use server";

import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ponytail: server action untuk catat jurnal umum manual double-entry.
// Guard ketat: tolak jika tidak balance, total 0, atau < 2 baris valid.

type RawLine = { account_id: string; debit: number; credit: number };

const kembali = (message: string) => redirect("/keuangan/jurnal?error=" + encodeURIComponent(message));

function parseCorrection(formData: FormData) {
  let lines: RawLine[] = [];
  try { lines = JSON.parse(String(formData.get("lines") ?? "[]")); } catch { lines = []; }
  return {
    requestKey: String(formData.get("draft_key") ?? formData.get("requestKey") ?? "").trim(),
    entryId: String(formData.get("entryId") ?? "").trim(),
    revision: Number(formData.get("revision") ?? 0),
    action: String(formData.get("action") ?? "").trim(),
    tanggal: String(formData.get("tanggal") ?? "").trim(),
    deskripsi: String(formData.get("deskripsi") ?? "").trim(),
    reason: String(formData.get("reason") ?? "").trim(), lines,
  };
}

export async function koreksiJurnal(formData: FormData) {
  const c = parseCorrection(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revise_manual_journal", {
    p_request_key: c.requestKey, p_entry_id: c.entryId, p_expected_revision: c.revision,
    p_action: "edit", p_header: { tanggal: c.tanggal, deskripsi: c.deskripsi }, p_lines: c.lines, p_reason: c.reason,
  });
  if (error || !data?.reversal_journal_id || !data?.replacement_journal_id) kembali(error?.message ?? "Koreksi jurnal belum terkonfirmasi");
  redirect("/keuangan/jurnal?success=1" + transactionDraftAck(formData));
}

export async function batalkanJurnal(formData: FormData) {
  const c = parseCorrection(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("revise_manual_journal", {
    p_request_key: c.requestKey, p_entry_id: c.entryId, p_expected_revision: c.revision,
    p_action: "void", p_header: {}, p_lines: [], p_reason: c.reason,
  });
  if (error || !data?.reversal_journal_id) kembali(error?.message ?? "Pembatalan jurnal belum terkonfirmasi");
  redirect("/keuangan/jurnal?success=1" + transactionDraftAck(formData));
}

export async function jurnalManual(formData: FormData) {
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "").trim() || null;
  const requestKey = String(formData.get("draft_key") ?? "").trim();
  if (!tanggal || !deskripsi || !requestKey) kembali("Tanggal, deskripsi dan identitas jurnal wajib tersedia.");
  let lines: unknown;
  try { lines = JSON.parse(String(formData.get("lines") ?? "[]")); }
  catch { kembali("Rincian jurnal tidak valid."); }
  if (!Array.isArray(lines)) kembali("Rincian jurnal tidak valid.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_manual_journal_atomic", {
    p_request_key: requestKey, p_tanggal: tanggal, p_deskripsi: deskripsi,
    p_branch_id: branchId, p_lines: lines,
  });
  if (error || !data?.entry_id) kembali(error?.message ?? "Jurnal belum terkonfirmasi. Periksa daftar sebelum mengulang.");
  redirect("/keuangan/jurnal?success=1" + transactionDraftAck(formData));
}
