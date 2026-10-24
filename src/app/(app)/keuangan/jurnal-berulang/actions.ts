"use server";

import { revalidatePath } from "next/cache";
import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { parseRecurringOccurrences } from "@/lib/recurring";
import { recurringSourceBounds, recurringSourcePeriodIndex } from "@/lib/recurring-source";
import { createClient } from "@/lib/supabase/server";

const BACK = "/keuangan/jurnal-berulang";
const ENTRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LineInput = { code: string; debit: number; credit: number };

export async function buatRecurring(formData: FormData) {
  const supabase = await createClient();
  const nama = String(formData.get("nama") ?? "").trim();
  const deskripsi = String(formData.get("deskripsi") ?? "").trim() || null;
  const day_of_month = Math.min(28, Math.max(1, Number(formData.get("day_of_month")) || 1));
  const branch_id = String(formData.get("branch_id") ?? "").trim() || null;

  let lines: LineInput[] = [];
  try { lines = JSON.parse(String(formData.get("lines") ?? "[]")) as LineInput[]; } catch { lines = []; }
  lines = lines.filter((l) => l.code && (Number(l.debit) > 0 || Number(l.credit) > 0));

  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);
  let max_occurrences: number | null = null;
  try { max_occurrences = parseRecurringOccurrences(formData.get("max_occurrences")); }
  catch (error) { fail(error instanceof Error ? error.message : "Jumlah pengulangan tidak valid."); }
  if (!nama || lines.length < 2) fail("Nama dan minimal 2 baris jurnal wajib diisi.");

  const totalD = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const totalK = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  if (Math.round(totalD) !== Math.round(totalK) || totalD <= 0) fail("Jurnal harus seimbang (total debit = total kredit).");

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("recurring_journals").insert({
    nama, deskripsi, day_of_month, max_occurrences, branch_id, lines, created_by: user?.id ?? null,
  });
  if (error) fail(error.message);

  revalidatePath(BACK);
  const pengulangan = max_occurrences === null ? "tanpa batas" : `sebanyak ${max_occurrences} kali`;
  redirect(`${BACK}?success=${encodeURIComponent(`Jurnal berulang "${nama}" tersimpan — diposting tiap bulan ${pengulangan}.`)}${transactionDraftAck(formData)}`);
}

export async function toggleRecurring(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  const { error } = await supabase.from("recurring_journals").update({ is_active: aktif }).eq("id", id);
  if (error) redirect(`${BACK}?error=${encodeURIComponent(`Status jurnal berulang gagal diperbarui: ${error.message}`)}`);
  revalidatePath(BACK);
  redirect(BACK);
}

function sourcePage(entryId: string, message: string) {
  redirect(`${BACK}/dari-jurnal/${encodeURIComponent(entryId)}?error=${encodeURIComponent(message)}`);
}

function rpcObject(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null;
}

function confirmedSchedule(value: unknown, expected: { sourceId: string; firstPeriod: string; count: number; lastPeriod: string }): string | null {
  const result = rpcObject(value);
  return typeof result?.schedule_id === "string" && ENTRY_ID.test(result.schedule_id)
    && result.source_id === expected.sourceId && result.first_period === expected.firstPeriod
    && result.last_period === expected.lastPeriod && result.count === expected.count && result.mode === "manual"
    ? result.schedule_id : null;
}

export async function startRecurringFromJournal(formData: FormData) {
  const supabase = await createClient();
  const requestKey = String(formData.get("requestKey") ?? "").trim();
  const sourceId = String(formData.get("source_entry_id") ?? "").trim();
  const rawSnapshot = String(formData.get("expected_snapshot") ?? "");
  let expectedSnapshot: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawSnapshot) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) expectedSnapshot = parsed as Record<string, unknown>;
  } catch { /* The source must be previewed again. */ }
  const name = String(formData.get("name") ?? "").trim();
  const firstPeriod = String(formData.get("first_period") ?? "").trim();
  const rawDay = String(formData.get("day") ?? "").trim();
  const day = Number(rawDay);
  const rawEnd = String(formData.get("end_period") ?? "").trim();
  const endPeriod = rawEnd || null;
  let count: number | null = null;
  try { count = parseRecurringOccurrences(formData.get("count")); }
  catch (error) { sourcePage(sourceId, error instanceof Error ? error.message : "Jumlah periode tidak valid."); }
  const backdated = String(formData.get("confirm_backdated") ?? "") === "1";
  const confirmSource = String(formData.get("confirm_source") ?? "") === "1";
  const invalid = !ENTRY_ID.test(sourceId) || requestKey.length < 1 || requestKey.length > 120
    || !expectedSnapshot || expectedSnapshot.entry_id !== sourceId || !name || name.length > 80
    || !Number.isInteger(day) || day < 1 || day > 28 || !confirmSource
    || recurringSourcePeriodIndex(firstPeriod) === null
    || (endPeriod !== null && recurringSourcePeriodIndex(endPeriod) === null);
  if (invalid) sourcePage(sourceId, "Periksa kembali sumber dan pilihan jadwal.");
  let boundsError = "";
  let expectedBounds: ReturnType<typeof recurringSourceBounds> | null = null;
  try {
    expectedBounds = recurringSourceBounds(firstPeriod, count, endPeriod);
  } catch (error) {
    boundsError = error instanceof Error ? error.message : "Rentang jadwal tidak valid.";
  }
  if (boundsError) sourcePage(sourceId, boundsError);
  {
    const sourceDate = String(expectedSnapshot?.tanggal ?? "");
    if (recurringSourcePeriodIndex(sourceDate.slice(0, 7)) === null
      || (recurringSourcePeriodIndex(firstPeriod) as number) <= (recurringSourcePeriodIndex(sourceDate.slice(0, 7)) as number)) {
      sourcePage(sourceId, "Bulan pertama harus setelah bulan jurnal sumber.");
    }
  }

  const payload = {
    p_request_key: requestKey,
    p_source_entry_id: sourceId,
    p_expected_snapshot: expectedSnapshot,
    p_name: name,
    p_first_period: firstPeriod,
    p_day: day,
    p_count: count,
    p_end_period: endPeriod,
    p_confirm_backdated: backdated,
    p_confirm_source: confirmSource,
  };
  const success = (value: unknown) => {
    const scheduleId = expectedBounds && confirmedSchedule(value, {
      sourceId, firstPeriod, count: expectedBounds.count, lastPeriod: expectedBounds.last_period,
    });
    if (!scheduleId) return false;
    revalidatePath(BACK);
    redirect(`${BACK}/${scheduleId}?success=created${transactionDraftAck(formData)}`);
  };
  let createResult: { data: unknown; error: { code?: string; message?: string } | null };
  try { createResult = await supabase.rpc("create_recurring_journal_from_source", payload); }
  catch { createResult = { data: null, error: { message: "Respons penyimpanan terputus." } }; }
  const { data, error } = createResult;
  if (success(data)) return;
  if (error) {
    // SQLSTATE errors confirm rejection. Network/transport errors may have
    // committed, so recover by the same request key before reporting uncertainty.
    if (!/^[0-9A-Z]{5}$/.test(String(error.code ?? ""))) {
      let recoveredData: unknown;
      try {
        const recovered = await supabase.rpc("get_recurring_journal_source_result", { p_request_key: requestKey });
        recoveredData = recovered.data;
      } catch { /* Keep the persisted request key; reload and inspect before retrying. */ }
      if (success(recoveredData)) return;
      sourcePage(sourceId, "Respons penyimpanan belum terkonfirmasi. Muat ulang daftar jadwal untuk memeriksa hasilnya.");
    }
    sourcePage(sourceId, error.message || "Jadwal jurnal sumber belum tersimpan.");
  }
  let recoveredData: unknown;
  try {
    const recovered = await supabase.rpc("get_recurring_journal_source_result", { p_request_key: requestKey });
    recoveredData = recovered.data;
  } catch { /* Keep the persisted request key; reload and inspect before retrying. */ }
  if (success(recoveredData)) return;
  sourcePage(sourceId, "Respons penyimpanan belum terkonfirmasi. Muat ulang daftar jadwal untuk memeriksa hasilnya.");
}

export async function postRecurringSourcePeriod(formData: FormData) {
  const scheduleId = String(formData.get("schedule_id") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  if (!ENTRY_ID.test(scheduleId) || recurringSourcePeriodIndex(period) === null) {
    redirect(`${BACK}?error=${encodeURIComponent("Identitas jadwal atau periode tidak valid.")}`);
  }
  const supabase = await createClient();
  const args = { p_schedule_id: scheduleId, p_period: period };
  let postResult: { data: unknown; error: { code?: string; message?: string } | null };
  try { postResult = await supabase.rpc("post_recurring_journal_source_period", args); }
  catch { postResult = { data: null, error: { message: "Respons posting terputus." } }; }
  let { data, error } = postResult;
  const matchesReceipt = (value: unknown): { schedule_id: string; period: string; entry_id: string; posted: boolean } | null => {
    const candidate = rpcObject(value);
    if (!candidate || candidate.schedule_id !== scheduleId || candidate.period !== period
      || typeof candidate.entry_id !== "string" || !ENTRY_ID.test(candidate.entry_id)
      || typeof candidate.posted !== "boolean") return null;
    return { schedule_id: scheduleId, period, entry_id: candidate.entry_id, posted: candidate.posted };
  };
  let result = matchesReceipt(data);
  if (!result && (!error || !/^[0-9A-Z]{5}$/.test(String(error.code ?? "")))) {
    try {
      postResult = await supabase.rpc("post_recurring_journal_source_period", args);
      ({ data, error } = postResult);
      result = matchesReceipt(data);
    } catch { /* The page will reload from the immutable occurrence receipt. */ }
  }
  const detail = `${BACK}/${scheduleId}`;
  if (error || !result) {
    revalidatePath(detail);
    redirect(`${detail}?error=${encodeURIComponent(error?.message ?? "Posting belum terkonfirmasi. Muat ulang rincian jadwal.")}`);
  }
  revalidatePath(BACK);
  revalidatePath(detail);
  revalidatePath("/keuangan/jurnal");
  if (result.posted) redirect(`${detail}?posted=${encodeURIComponent(result.entry_id)}&entry=${encodeURIComponent(result.entry_id)}`);
  redirect(`${detail}?replayed=1&entry=${encodeURIComponent(result.entry_id)}`);
}
