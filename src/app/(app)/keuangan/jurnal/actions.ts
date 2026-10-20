"use server";

import { transactionDraftAck } from "@/lib/transaction-draft-ack";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nextSeqJurnal, prefixJurnal } from "@/lib/posting";
import { acakSuffix, kandidatNomor } from "@/lib/no-dokumen";

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

  // Nomor jurnal diambil dari nomor tertinggi bulan itu (lihat nextSeqJurnal) — sama
  // seperti jurnal otomatis, supaya lubang penomoran tidak mematikan layar ini.
  const prefix = prefixJurnal(tanggal);
  const seq = await nextSeqJurnal(supabase, tanggal);

  // Dua pengguna menyimpan bersamaan bisa dapat nomor sama; unique constraint jadi
  // backstop, jadi coba nomor berikutnya sebelum menyerah.
  let entry: { id: string } | null = null;
  let entryErr: { message?: string } | null = null;
  for (const noJurnal of kandidatNomor(`${prefix}-`, seq, 4, acakSuffix())) {
    const { data, error } = await supabase
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
    if (data) { entry = data; entryErr = null; break; }
    entryErr = error;
    if (error?.code !== "23505") break;
  }

  if (!entry)
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

  if (lineErr) {
    // hapus header supaya tidak ada entri jurnal tanpa baris (yatim).
    await supabase.from("journal_entries").delete().eq("id", entry!.id);
    redirect(
      "/keuangan/jurnal?error=" + encodeURIComponent(lineErr.message)
    );
  }

  redirect("/keuangan/jurnal?success=1" + transactionDraftAck(formData));
}
