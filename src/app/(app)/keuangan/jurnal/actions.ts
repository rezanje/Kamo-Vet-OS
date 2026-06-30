"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ponytail: server action untuk catat jurnal umum manual double-entry.
// Guard ketat: tolak jika tidak balance, total 0, atau < 2 baris valid.

type RawLine = { account_id: string; debit: number; credit: number };

export async function jurnalManual(formData: FormData) {
  const supabase = await createClient();

  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const deskripsi = String(formData.get("deskripsi") ?? "").trim();
  const branchId = String(formData.get("branchId") ?? "").trim() || null;

  if (!tanggal) redirect("/keuangan/jurnal?error=" + encodeURIComponent("Tanggal wajib diisi"));
  if (!deskripsi) redirect("/keuangan/jurnal?error=" + encodeURIComponent("Deskripsi wajib diisi"));

  let rawLines: RawLine[] = [];
  try {
    rawLines = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    rawLines = [];
  }

  // Filter baris valid: punya akun dan salah satu debit/kredit > 0
  const lines = rawLines.filter(
    (l) => l.account_id?.trim() && (Number(l.debit) > 0 || Number(l.credit) > 0)
  );

  const totalDebit = lines.reduce((a, l) => a + Number(l.debit), 0);
  const totalKredit = lines.reduce((a, l) => a + Number(l.credit), 0);

  // §SERVER-GUARD: tolak entri tidak balance — penjaga uang, jangan hapus.
  // Cek dilakukan setelah parse client; jangan percaya state klien.
  if (lines.length < 2)
    redirect("/keuangan/jurnal?error=" + encodeURIComponent("Minimal 2 baris jurnal valid"));
  if (totalDebit === 0)
    redirect("/keuangan/jurnal?error=" + encodeURIComponent("Total debit tidak boleh nol"));
  if (Math.round(totalDebit) !== Math.round(totalKredit))
    redirect(
      "/keuangan/jurnal?error=" +
        encodeURIComponent(
          `Jurnal tidak balance (selisih Rp ${Math.abs(totalDebit - totalKredit).toLocaleString("id-ID")})`
        )
    );

  // Generate no_jurnal: JRN-YYYYMM-NNNN
  const now = new Date(tanggal);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `JRN-${yyyy}${mm}`;
  const { count } = await supabase
    .from("journal_entries")
    .select("*", { count: "exact", head: true })
    .like("no_jurnal", `${prefix}-%`);
  const noJurnal = `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .insert({
      no_jurnal: noJurnal,
      tanggal,
      deskripsi,
      source: "manual",
      source_ref: null,
      branch_id: branchId,
    })
    .select("id")
    .single();

  if (entryErr || !entry)
    redirect(
      "/keuangan/jurnal?error=" +
        encodeURIComponent(entryErr?.message ?? "Gagal menyimpan jurnal")
    );

  const { error: lineErr } = await supabase.from("journal_lines").insert(
    lines.map((l) => ({
      entry_id: entry!.id,
      account_id: l.account_id,
      debit: Number(l.debit),
      credit: Number(l.credit),
    }))
  );

  if (lineErr)
    redirect(
      "/keuangan/jurnal?error=" + encodeURIComponent(lineErr.message)
    );

  redirect("/keuangan/jurnal?success=1");
}
