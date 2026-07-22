// Agregasi buku besar dari journal_lines + coa_accounts. Read-only, hitung di JS
// (volume prototype kecil). Saldo per akun mengikuti sifat saldo normal.
// Semua fungsi menerima filter periode (from/to, inklusif) + cabang.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type LedgerFilter = { from?: string; to?: string; branchId?: string; branchIds?: string[] };

export type AccountBalance = {
  code: string; name: string; type: string; normal: string;
  debit: number; credit: number; saldo: number;
};

const TYPE_ORDER = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"];

type RawLine = {
  account_id: string; debit: number; credit: number;
  journal_entries: { tanggal: string; branch_id: string | null; source: string; no_jurnal: string | null; deskripsi: string | null } | null;
};

// Satu jalur query untuk semua laporan — join inner ke journal_entries supaya
// filter tanggal/cabang berlaku konsisten.
async function fetchLines(supabase: AnyClient, f?: LedgerFilter): Promise<RawLine[]> {
  let q = supabase
    .from("journal_lines")
    .select("account_id, debit, credit, journal_entries!inner(tanggal, branch_id, source, no_jurnal, deskripsi)");
  if (f?.from) q = q.gte("journal_entries.tanggal", f.from);
  if (f?.to) q = q.lte("journal_entries.tanggal", f.to);
  if (f?.branchId) q = q.eq("journal_entries.branch_id", f.branchId);
  if (f?.branchIds?.length) q = q.in("journal_entries.branch_id", f.branchIds);
  const { data } = await q;
  return ((data ?? []) as RawLine[]).map((r) => ({
    ...r,
    journal_entries: Array.isArray(r.journal_entries) ? r.journal_entries[0] : r.journal_entries,
  }));
}

export async function getAccountBalances(supabase: AnyClient, f?: LedgerFilter): Promise<AccountBalance[]> {
  const [{ data: accs }, lines] = await Promise.all([
    supabase.from("coa_accounts").select("id, code, name, type, normal_balance") as Promise<{ data: { id: string; code: string; name: string; type: string; normal_balance: string }[] | null }>,
    fetchLines(supabase, f),
  ]);

  const agg = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
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
export async function getAccountLedger(supabase: AnyClient, code: string, f?: LedgerFilter): Promise<LedgerLine[]> {
  const { data: accs } = (await supabase.from("coa_accounts").select("id").eq("code", code)) as { data: { id: string }[] | null };
  const accId = accs?.[0]?.id;
  if (!accId) return [];

  const lines = await fetchLines(supabase, f);
  const rows = lines
    .filter((l) => l.account_id === accId)
    .map((r) => ({
      tanggal: r.journal_entries?.tanggal ?? "",
      no_jurnal: r.journal_entries?.no_jurnal ?? "",
      deskripsi: r.journal_entries?.deskripsi ?? "",
      debit: Number(r.debit),
      credit: Number(r.credit),
    }));
  rows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.no_jurnal.localeCompare(b.no_jurnal));
  return rows;
}

// Arus kas metode langsung: mutasi jurnal yang menyentuh akun kas/bank (1101,1102),
// dikelompokkan per source. masuk = debit ke kas, keluar = credit dari kas.
// saldoAwal = posisi kas sebelum `from` (supaya laporan per periode tetap nyambung).
export type CashMove = { source: string; masuk: number; keluar: number };

async function cashAccountIds(supabase: AnyClient): Promise<Set<string>> {
  const { data } = (await supabase.from("coa_accounts").select("id, code").in("code", ["1101", "1102"])) as { data: { id: string }[] | null };
  return new Set((data ?? []).map((a) => a.id));
}

export async function getCashMovements(
  supabase: AnyClient,
  f?: LedgerFilter,
): Promise<{ moves: CashMove[]; saldoKasNow: number; saldoAwal: number }> {
  const cashIds = await cashAccountIds(supabase);
  if (cashIds.size === 0) return { moves: [], saldoKasNow: 0, saldoAwal: 0 };

  const lines = await fetchLines(supabase, f);
  const agg = new Map<string, CashMove>();
  let saldo = 0;
  for (const l of lines) {
    if (!cashIds.has(l.account_id)) continue;
    const src = l.journal_entries?.source ?? "manual";
    const cur = agg.get(src) ?? { source: src, masuk: 0, keluar: 0 };
    cur.masuk += Number(l.debit);
    cur.keluar += Number(l.credit);
    agg.set(src, cur);
    saldo += Number(l.debit) - Number(l.credit);
  }

  // saldo kas sebelum periode (kalau ada batas bawah).
  let saldoAwal = 0;
  if (f?.from) {
    const prevDay = new Date(f.from + "T00:00:00");
    prevDay.setDate(prevDay.getDate() - 1);
    const to = prevDay.toISOString().slice(0, 10);
    const before = await fetchLines(supabase, { to, branchId: f.branchId });
    for (const l of before) {
      if (!cashIds.has(l.account_id)) continue;
      saldoAwal += Number(l.debit) - Number(l.credit);
    }
  }

  return { moves: [...agg.values()], saldoKasNow: saldo + saldoAwal, saldoAwal };
}
