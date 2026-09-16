"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";

const BACK = "/keuangan/jurnal-berulang";

type LineInput = { code: string; debit: number; credit: number };

export async function buatRecurring(formData: FormData) {
  const supabase = await createClient();
  const nama = String(formData.get("nama") ?? "").trim();
  const deskripsi = String(formData.get("deskripsi") ?? "").trim() || null;
  const day_of_month = Math.min(28, Math.max(1, Number(formData.get("day_of_month")) || 1));
  const frequency = String(formData.get("frequency") ?? "monthly");
  const start_date = String(formData.get("start_date") ?? "").trim() || hariIniWIB();
  const repeat_count = Number(formData.get("repeat_count"));
  const branch_id = String(formData.get("branch_id") ?? "").trim() || null;

  let lines: LineInput[] = [];
  try { lines = JSON.parse(String(formData.get("lines") ?? "[]")) as LineInput[]; } catch { lines = []; }
  lines = lines.filter((l) => l.code && (Number(l.debit) > 0 || Number(l.credit) > 0));

  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);
  if (!nama || lines.length < 2) fail("Nama dan minimal 2 baris jurnal wajib diisi.");
  if (!(["daily", "monthly"] as string[]).includes(frequency)) fail("Periode harus Harian atau Bulanan.");
  if (!Number.isInteger(repeat_count) || repeat_count <= 0) fail("Jumlah pengulangan wajib lebih dari nol.");

  const totalD = lines.reduce((a, l) => a + (Number(l.debit) || 0), 0);
  const totalK = lines.reduce((a, l) => a + (Number(l.credit) || 0), 0);
  if (Math.round(totalD) !== Math.round(totalK) || totalD <= 0) fail("Jurnal harus seimbang (total debit = total kredit).");

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("recurring_journals").insert({
    nama, deskripsi, day_of_month, branch_id, lines, frequency, start_date, repeat_count,
    run_count: 0, status: "active", is_active: true, created_by: user?.id ?? null,
  });
  if (error) fail(error.message);

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(`Jurnal berulang "${nama}" tersimpan — otomatis diposting tiap bulan.`)}`);
}

export async function toggleRecurring(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const aktif = String(formData.get("aktif") ?? "") === "1";
  await supabase.from("recurring_journals")
    .update({ is_active: aktif, status: aktif ? "active" : "inactive" })
    .eq("id", id)
    .neq("status", "completed");
  revalidatePath(BACK);
  redirect(BACK);
}

export async function jalankanSekarang(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const { error } = await supabase.rpc("run_recurring_occurrence", { p_schedule_id: id, p_run_date: hariIniWIB() });
  revalidatePath(BACK);
  redirect(error ? `${BACK}?error=${encodeURIComponent(error.message)}` : `${BACK}?success=${encodeURIComponent("Transaksi dijalankan satu kali; permintaan ganda pada tanggal yang sama diabaikan.")}`);
}
