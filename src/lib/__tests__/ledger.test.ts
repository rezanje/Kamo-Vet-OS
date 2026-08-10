import { describe, it, expect } from "vitest";
import { getAccountBalances, nilaiSeksi } from "../ledger";

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

describe("nilaiSeksi — akun kontra jadi pengurang kelompoknya", () => {
  it("aset biasa (saldo normal D) tetap positif", () => {
    expect(nilaiSeksi({ type: "ASET", normal: "D", saldo: 1_000_000 })).toBe(1_000_000);
  });

  // Akumulasi Penyusutan: bertipe ASET tapi saldo normal Kredit. Kalau ini positif,
  // penyusutan malah MENAMBAH total aktiva.
  it("akumulasi penyusutan (ASET saldo normal K) mengurangi total aktiva", () => {
    expect(nilaiSeksi({ type: "ASET", normal: "K", saldo: 822_083 })).toBe(-822_083);
  });

  it("liabilitas & ekuitas normal K tetap positif; potongan bersaldo D jadi negatif", () => {
    expect(nilaiSeksi({ type: "LIABILITAS", normal: "K", saldo: 500_000 })).toBe(500_000);
    expect(nilaiSeksi({ type: "EKUITAS", normal: "D", saldo: 250_000 })).toBe(-250_000);
  });

  it("neraca tetap seimbang setelah aturan ini diterapkan", () => {
    const akun = [
      { type: "ASET", normal: "D", saldo: 1_415_000 },       // kas & bank
      { type: "ASET", normal: "K", saldo: 822_083 },          // akumulasi penyusutan
      { type: "ASET", normal: "D", saldo: 1_000_000 },        // aset tetap
      { type: "LIABILITAS", normal: "K", saldo: 180_000 },
      { type: "EKUITAS", normal: "K", saldo: 1_412_917 },
    ];
    const sisi = (t: string) => akun.filter((a) => a.type === t).reduce((s, a) => s + nilaiSeksi(a), 0);
    expect(sisi("ASET")).toBe(sisi("LIABILITAS") + sisi("EKUITAS"));
  });
});
