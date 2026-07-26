import { describe, it, expect } from "vitest";
import { getAccountBalances } from "../ledger";

// Mock supabase minimal: coa_accounts tetap, journal_lines difilter oleh chain gte/lte/eq/in
// persis seperti fetchLines() memanggilnya (query-builder chainable + thenable).
type Line = {
  account_id: string; debit: number; credit: number;
  journal_entries: { tanggal: string; branch_id: string | null; source: string; no_jurnal: string | null; deskripsi: string | null };
};

function makeClient(accounts: { id: string; code: string; name: string; type: string; normal_balance: string }[], lines: Line[]) {
  return {
    from(table: string) {
      if (table === "coa_accounts") {
        return { select: async () => ({ data: accounts }) };
      }
      if (table === "journal_lines") {
        let rows = lines;
        const builder = {
          select() { return builder; },
          gte(_col: string, val: string) { rows = rows.filter((l) => l.journal_entries.tanggal >= val); return builder; },
          lte(_col: string, val: string) { rows = rows.filter((l) => l.journal_entries.tanggal <= val); return builder; },
          eq(_col: string, val: string) { rows = rows.filter((l) => l.journal_entries.branch_id === val); return builder; },
          in(_col: string, vals: string[]) { rows = rows.filter((l) => vals.includes(l.journal_entries.branch_id as string)); return builder; },
          then(resolve: (v: { data: Line[] }) => void) { return resolve({ data: rows }); },
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const accounts = [
  { id: "acc-4101", code: "4101", name: "Penjualan", type: "PENDAPATAN", normal_balance: "K" },
];

const lines: Line[] = [
  { account_id: "acc-4101", debit: 0, credit: 100_000, journal_entries: { tanggal: "2026-07-01", branch_id: "b1", source: "sale", no_jurnal: "J1", deskripsi: null } },
  { account_id: "acc-4101", debit: 0, credit: 200_000, journal_entries: { tanggal: "2026-07-02", branch_id: "b2", source: "sale", no_jurnal: "J2", deskripsi: null } },
];

describe("getAccountBalances — filter branchIds", () => {
  it("branchIds undefined = tanpa filter cabang (semua baris ikut)", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, {});
    expect(bal.find((b) => b.code === "4101")?.saldo).toBe(300_000);
  });

  it("branchIds [] (allow-list eksplisit kosong) = tidak ada baris, BUKAN semua cabang", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, { branchIds: [] });
    expect(bal.find((b) => b.code === "4101")?.saldo).toBe(0);
  });

  it("branchIds terisi = filter seperti biasa", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, { branchIds: ["b1"] });
    expect(bal.find((b) => b.code === "4101")?.saldo).toBe(100_000);
  });
});
