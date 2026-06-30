// Agregasi buku besar dari journal_lines + coa_accounts. Read-only, hitung di JS
// (volume prototype kecil). Saldo per akun mengikuti sifat saldo normal.

type AnyClient = {
  from: (t: string) => {
    select: (s: string, o?: unknown) => Promise<{ data: unknown[] | null }> & {
      eq: (c: string, v: string) => Promise<{ data: unknown[] | null }>;
      order: (c: string, o?: unknown) => Promise<{ data: unknown[] | null }>;
    };
  };
};

export type AccountBalance = {
  code: string; name: string; type: string; normal: string;
  debit: number; credit: number; saldo: number;
};

const TYPE_ORDER = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"];

export async function getAccountBalances(supabase: AnyClient): Promise<AccountBalance[]> {
  const [{ data: accs }, { data: lines }] = await Promise.all([
    supabase.from("coa_accounts").select("id, code, name, type, normal_balance") as Promise<{ data: { id: string; code: string; name: string; type: string; normal_balance: string }[] | null }>,
    supabase.from("journal_lines").select("account_id, debit, credit") as Promise<{ data: { account_id: string; debit: number; credit: number }[] | null }>,
  ]);

  const agg = new Map<string, { debit: number; credit: number }>();
  for (const l of lines ?? []) {
    const cur = agg.get(l.account_id) ?? { debit: 0, credit: 0 };
    cur.debit += Number(l.debit);
    cur.credit += Number(l.credit);
    agg.set(l.account_id, cur);
  }

  return (accs ?? [])
    .map((a) => {
      const m = agg.get(a.id) ?? { debit: 0, credit: 0 };
      const saldo = a.normal_balance === "D" ? m.debit - m.credit : m.credit - m.debit;
      return { code: a.code, name: a.name, type: a.type, normal: a.normal_balance, debit: m.debit, credit: m.credit, saldo };
    })
    .sort((x, y) => (TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type)) || x.code.localeCompare(y.code));
}

export type LedgerLine = { tanggal: string; no_jurnal: string; deskripsi: string; debit: number; credit: number };

// Mutasi satu akun (untuk buku besar detail), urut tanggal — saldo berjalan dihitung di page.
export async function getAccountLedger(supabase: AnyClient, code: string): Promise<LedgerLine[]> {
  const { data: accs } = (await supabase.from("coa_accounts").select("id").eq("code", code)) as { data: { id: string }[] | null };
  const accId = accs?.[0]?.id;
  if (!accId) return [];
  const { data } = (await supabase
    .from("journal_lines")
    .select("debit, credit, entry_id, journal_entries(no_jurnal, tanggal, deskripsi)")
    .eq("account_id", accId)) as { data: { debit: number; credit: number; journal_entries: { no_jurnal: string; tanggal: string; deskripsi: string } | { no_jurnal: string; tanggal: string; deskripsi: string }[] | null }[] | null };

  const rows = (data ?? []).map((r) => {
    const je = Array.isArray(r.journal_entries) ? r.journal_entries[0] : r.journal_entries;
    return { tanggal: je?.tanggal ?? "", no_jurnal: je?.no_jurnal ?? "", deskripsi: je?.deskripsi ?? "", debit: Number(r.debit), credit: Number(r.credit) };
  });
  rows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_jurnal.localeCompare(b.no_jurnal));
  return rows;
}
