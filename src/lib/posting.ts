// ponytail: app-level posting; a hardened version would use a DB trigger/RPC in one transaction.
import { acakSuffix, kandidatNomor, urutanBerikutnya } from "./no-dokumen";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type PostLine = { code: string; debit: number; credit: number };
type PostOpts = {
  tanggal: string;
  deskripsi: string;
  source: string;
  sourceRef?: string | null;
  branchId?: string | null;
  lines: PostLine[];
};

/** Prefix nomor jurnal satu bulan. Pakai string slice (bukan new Date) supaya bulan
 *  tidak bergeser akibat timezone server non-UTC. */
export const prefixJurnal = (tanggal: string) => `JRN-${tanggal.slice(0, 7).replace("-", "")}`;

/** Urutan jurnal berikutnya — lihat lib/no-dokumen untuk kenapa bukan count+1. */
export async function nextSeqJurnal(supabase: AnyClient, tanggal: string): Promise<number> {
  return urutanBerikutnya(supabase, {
    table: "journal_entries",
    column: "no_jurnal",
    prefix: `${prefixJurnal(tanggal)}-`,
    pad: 4,
  });
}

/**
 * Best-effort accounting post. Returns success so callers with mandatory journals
 * can undo their own record when posting fails.
 */
export async function postJournal(supabase: AnyClient, opts: PostOpts): Promise<boolean> {
  try {
    const { tanggal, deskripsi, source, sourceRef, branchId, lines } = opts;

    // Filter to only lines with actual amounts.
    const active = lines.filter((l) => l.debit > 0 || l.credit > 0);
    if (active.length < 1) return false;

    const totalDebit = active.reduce((a, l) => a + l.debit, 0);
    const totalKredit = active.reduce((a, l) => a + l.credit, 0);

    // Defensive: never post an unbalanced or zero entry.
    if (totalDebit === 0 || Math.round(totalDebit) !== Math.round(totalKredit)) return false;

    // Resolve account codes → ids.
    const codes = [...new Set(active.map((l) => l.code))];
    const { data: accounts, error: accErr } = await supabase
      .from("coa_accounts")
      .select("id, code, is_header")
      .in("code", codes);
    if (accErr || !accounts) return false;

    const codeToId: Record<string, string> = {};
    for (const row of accounts as { id: string; code: string; is_header?: boolean }[]) {
      // Akun induk cuma menjumlahkan rinciannya. Kalau ikut diposting, angkanya
      // dihitung dua kali di laporan — sekali sebagai saldonya sendiri, sekali
      // lagi lewat penjumlahan anaknya.
      if (row.is_header) {
        console.error(`[jurnal] akun ${row.code} adalah akun induk — tidak boleh dijurnal`);
        return false;
      }
      codeToId[row.code] = row.id;
    }

    // If any line's code is missing, abort.
    for (const l of active) {
      if (!codeToId[l.code]) return false;
    }

    // Generate no_jurnal = JRN-YYYYMM-NNNN from tanggal's year+month.
    const prefix = prefixJurnal(tanggal);

    // Nomor berikutnya bisa race di request paralel; unique constraint jadi backstop —
    // kalau tabrakan (23505), coba ulang dengan nomor berikutnya lalu suffix acak.
    const seq = await nextSeqJurnal(supabase, tanggal);
    const candidates = kandidatNomor(`${prefix}-`, seq, 4, acakSuffix());
    let entry: { id: string } | null = null;
    for (const noJurnal of candidates) {
      const { data, error: entryErr } = await supabase
        .from("journal_entries")
        .insert({
          no_jurnal: noJurnal,
          tanggal,
          deskripsi,
          source,
          source_ref: sourceRef ?? null,
          branch_id: branchId ?? null,
        })
        .select("id")
        .single();
      if (data) { entry = data; break; }
      if (entryErr?.code !== "23505") return false; // error lain: menyerah (best-effort)
    }
    if (!entry) return false;

    // Insert journal_lines.
    const lineRows = active.map((l) => ({
      entry_id: entry.id,
      account_id: codeToId[l.code],
      debit: l.debit,
      credit: l.credit,
    }));
    const { error: lineErr } = await supabase.from("journal_lines").insert(lineRows);
    if (lineErr) {
      // jangan tinggalkan header tanpa baris — hapus supaya tidak jadi entri yatim.
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      return false;
    }
    return true;
  } catch (err) {
    // Best-effort: swallow any error so the primary transaction is never blocked.
    console.error("[postJournal] accounting error (ignored):", err);
    return false;
  }
}
