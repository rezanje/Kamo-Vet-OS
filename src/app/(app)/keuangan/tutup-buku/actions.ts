"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountBalances } from "@/lib/ledger";
import { buildClosingLines } from "@/lib/tutup-buku";
import { nextSeqJurnal, prefixJurnal } from "@/lib/posting";
import { formatNomor } from "@/lib/no-dokumen";

const BACK = "/keuangan/tutup-buku";

/**
 * Simpan tanggal kunci periode. Pakai UPSERT, bukan UPDATE.
 *
 * accounting_locks adalah tabel satu-baris. Saat audit ditemukan barisnya TIDAK ADA di
 * database, sehingga `update ... eq("id", true)` mengenai 0 baris tanpa melempar error:
 * layar melaporkan "periode dikunci" padahal tidak ada yang terkunci, dan trigger
 * pengamannya membaca null (= periode selalu terbuka). Upsert membuat barisnya kalau
 * belum ada, jadi kuncinya tidak bisa gagal diam-diam lagi.
 */
async function simpanKunci(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tanggal: string | null,
  userId: string | null,
) {
  return supabase.from("accounting_locks").upsert({
    id: true, closed_until: tanggal, updated_by: userId, updated_at: new Date().toISOString(),
  });
}

// Set / geser / lepas tanggal kunci periode. Jurnal <= tanggal ini terkunci (DB trigger).
export async function setKunci(formData: FormData) {
  const supabase = await createClient();
  const tanggal = String(formData.get("closed_until") ?? "").trim() || null;

  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await simpanKunci(supabase, tanggal, user?.id ?? null);
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

  const prefix = `${prefixJurnal(tanggal)}-`;
  const no_jurnal = formatNomor(prefix, await nextSeqJurnal(supabase, tanggal), 4);

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

  // Kunci periode sampai tanggal tutup. Kegagalan di sini TIDAK boleh senyap —
  // jurnal penutup sudah terlanjur diposting, jadi periodenya wajib benar-benar terkunci.
  const { data: { user } } = await supabase.auth.getUser();
  const { error: kunciErr } = await simpanKunci(supabase, tanggal, user?.id ?? null);
  if (kunciErr) fail(`Jurnal penutup tersimpan (${no_jurnal}) tapi periode GAGAL dikunci: ${kunciErr.message}`);

  revalidatePath(BACK);
  redirect(`${BACK}?success=${encodeURIComponent(
    `Tutup buku s/d ${tanggal} beres — laba/rugi Rp ${Math.round(laba).toLocaleString("id-ID")} dipindah ke Laba Ditahan (${no_jurnal}), periode dikunci.`,
  )}`);
}
