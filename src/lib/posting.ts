// ponytail: app-level posting; a hardened version would use a DB trigger/RPC in one transaction.
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

/**
 * Best-effort accounting post. Never throws — accounting must not break the primary transaction.
 */
export async function postJournal(supabase: AnyClient, opts: PostOpts): Promise<void> {
  try {
    const { tanggal, deskripsi, source, sourceRef, branchId, lines } = opts;

    // Filter to only lines with actual amounts.
    const active = lines.filter((l) => l.debit > 0 || l.credit > 0);
    if (active.length < 1) return;

    const totalDebit = active.reduce((a, l) => a + l.debit, 0);
    const totalKredit = active.reduce((a, l) => a + l.credit, 0);

    // Defensive: never post an unbalanced or zero entry.
    if (totalDebit === 0 || Math.round(totalDebit) !== Math.round(totalKredit)) return;

    // Resolve account codes → ids.
    const codes = [...new Set(active.map((l) => l.code))];
    const { data: accounts, error: accErr } = await supabase
      .from("coa_accounts")
      .select("id, code")
      .in("code", codes);
    if (accErr || !accounts) return;

    const codeToId: Record<string, string> = {};
    for (const row of accounts as { id: string; code: string }[]) {
      codeToId[row.code] = row.id;
    }

    // If any line's code is missing, abort.
    for (const l of active) {
      if (!codeToId[l.code]) return;
    }

    // Generate no_jurnal = JRN-YYYYMM-NNNN from tanggal's year+month.
    const prefix = `JRN-${tanggal.slice(0, 7).replace("-", "")}`;
    const { count } = await supabase
      .from("journal_entries")
      .select("*", { count: "exact", head: true })
      .like("no_jurnal", `${prefix}-%`);
    const noJurnal = `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;

    // Insert journal_entries.
    const { data: entry, error: entryErr } = await supabase
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
    if (entryErr || !entry) return;

    // Insert journal_lines.
    const lineRows = active.map((l) => ({
      entry_id: entry.id,
      account_id: codeToId[l.code],
      debit: l.debit,
      credit: l.credit,
    }));
    await supabase.from("journal_lines").insert(lineRows);
  } catch (err) {
    // Best-effort: swallow any error so the primary transaction is never blocked.
    console.error("[postJournal] accounting error (ignored):", err);
  }
}
