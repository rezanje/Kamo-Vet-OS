"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseRecurringOccurrences } from "@/lib/recurring";
import { createClient } from "@/lib/supabase/server";

const BACK = "/keuangan/jurnal-berulang";

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
  redirect(`${BACK}?success=${encodeURIComponent(`Jurnal berulang "${nama}" tersimpan — diposting tiap bulan ${pengulangan}.`)}`);
}

export async function toggleRecurring(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  await supabase.from("recurring_journals").update({ is_active: aktif }).eq("id", id);
  revalidatePath(BACK);
  redirect(BACK);
}
