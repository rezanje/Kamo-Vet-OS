"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountBalances } from "@/lib/ledger";
import { buildClosingLines } from "@/lib/tutup-buku";

const BACK = "/keuangan/tutup-buku";

// Set / geser / lepas tanggal kunci periode. Jurnal <= tanggal ini terkunci (DB trigger).
export async function setKunci(formData: FormData) {
  const supabase = await createClient();
  const tanggal = String(formData.get("closed_until") ?? "").trim() || null;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("accounting_locks")
    .update({ closed_until: tanggal, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) redirect(`${BACK}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(tanggal ? `Periode s/d ${tanggal} dikunci.` : "Kunci periode dilepas.")}`);
}

// Tutup buku: jurnal penutup P&L s/d tanggal cutoff -> Laba Ditahan, lalu kunci periode.
export async function tutupBuku(formData: FormData) {
  const supabase = await createClient();
  const tanggal = String(formData.get("tanggal") ?? "").trim();
  const fail = (msg: string) => redirect(`${BACK}?error=${encodeURIComponent(msg)}`);
  if (!tanggal) fail("Tanggal tutup buku wajib diisi.");

  // Saldo P&L s/d cutoff (semua cabang). Jurnal penutup sebelumnya ikut kehitung,
  // jadi tutup buku ulang hanya menangkap aktivitas baru (self-correcting).
  const balances = await getAccountBalances(supabase as never, { to: tanggal });
  const { lines, laba } = buildClosingLines(balances);
  if (lines.length === 0) fail("Tidak ada saldo pendapatan/beban untuk ditutup pada periode ini.");

  // Posting langsung (bukan postJournal best-effort — tutup buku wajib ketahuan gagal/sukses).
  const codes = [...new Set(lines.map((l) => l.code))];
  const { data: accounts } = await supabase.from("coa_accounts").select("id, code").in("code", codes);
  const codeToId = new Map((accounts ?? []).map((a) => [a.code as string, a.id as string]));
  for (const l of lines) if (!codeToId.has(l.code)) fail(`Akun ${l.code} tidak ditemukan di COA.`);

  const prefix = `JRN-${tanggal.slice(0, 7).replace("-", "")}`;
  const { count } = await supabase
    .from("journal_entries").select("*", { count: "exact", head: true })
    .like("no_jurnal", `${prefix}-%`);
  const no_jurnal = `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .insert({
      no_jurnal, tanggal,
      deskripsi: `Jurnal penutup — tutup buku s/d ${tanggal}`,
      source: "closing", source_ref: tanggal, branch_id: null,
    })
    .select("id").single();
  if (entryErr || !entry) fail(`Gagal posting jurnal penutup: ${entryErr?.message ?? "unknown"}`);

  const { error: lineErr } = await supabase.from("journal_lines").insert(
    lines.map((l) => ({ entry_id: entry!.id, account_id: codeToId.get(l.code), debit: l.debit, credit: l.credit })),
  );
  if (lineErr) {
    await supabase.from("journal_entries").delete().eq("id", entry!.id);
    fail(`Gagal posting baris jurnal penutup: ${lineErr.message}`);
  }

  // Kunci periode sampai tanggal tutup.
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("accounting_locks")
    .update({ closed_until: tanggal, updated_by: user?.id ?? null, updated_at: new Date().toISOString() })
    .eq("id", true);

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(
    `Tutup buku s/d ${tanggal} beres — laba/rugi Rp ${Math.round(laba).toLocaleString("id-ID")} dipindah ke Laba Ditahan (${no_jurnal}), periode dikunci.`,
  )}`);
}
