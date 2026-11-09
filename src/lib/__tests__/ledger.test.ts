import { describe, it, expect } from "vitest";
import { getAccountBalances, getAccountLedger, nilaiSeksi } from "../ledger";

// Mock supabase minimal: coa_accounts tetap, journal_lines difilter oleh chain gte/lte/eq/in
// persis seperti fetchLines() memanggilnya (query-builder chainable + thenable).
type Line = {
  account_id: string; debit: number; credit: number;
  journal_entries: { tanggal: string; branch_id: string | null; source: string; source_ref?: string | null; no_jurnal: string | null; deskripsi: string | null; branches?: { name: string } | null };
};

function makeClient(accounts: { id: string; code: string; name: string; type: string; normal_balance: string }[], lines: Line[]) {
  return {
    from(table: string) {
      if (table === "coa_accounts") {
        const builder = {
          select() { return builder; },
          order() { return builder; },
          range(from: number, to: number) { return Promise.resolve({ data: accounts.slice(from, to + 1), count: accounts.length, error: null }); },
          eq(_col: string, val: string) { return { order() { return { range() { const data = accounts.filter(a => a.code === val); return Promise.resolve({ data, count: data.length, error: null }); } }; } }; },
          then(resolve: (v: { data: typeof accounts }) => void) { return resolve({ data: accounts }); },
        };
        return builder;
      }
      if (table === "journal_lines") {
        let rows = lines.map((line, id) => ({ ...line, id: String(id) }));
        const builder = {
          select() { return builder; },
          order() { return builder; },
          range(from: number, to: number) { return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }); },
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
  { id: "acc-4101", code: "510001", name: "Penjualan", type: "PENDAPATAN", normal_balance: "K" },
];

const lines: Line[] = [
  { account_id: "acc-4101", debit: 0, credit: 100_000, journal_entries: { tanggal: "2026-07-01", branch_id: "b1", source: "sale", no_jurnal: "J1", deskripsi: null } },
  { account_id: "acc-4101", debit: 0, credit: 200_000, journal_entries: { tanggal: "2026-07-02", branch_id: "b2", source: "sale", no_jurnal: "J2", deskripsi: null } },
];

describe("getAccountBalances — filter branchIds", () => {
  it("branchIds undefined = tanpa filter cabang (semua baris ikut)", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, {});
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(300_000);
  });

  it("branchIds [] (allow-list eksplisit kosong) = tidak ada baris, BUKAN semua cabang", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, { branchIds: [] });
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(0);
  });

  it("branchIds terisi = filter seperti biasa", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, { branchIds: ["b1"] });
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(100_000);
  });
});

describe("getAccountLedger — asal cabang", () => {
  it("membawa nama cabang di rincian akun", async () => {
    const source = [{ ...lines[0], journal_entries: { ...lines[0].journal_entries, source_ref: "INV-1", branches: { name: "Klinik A" } } }];
    const ledger = await getAccountLedger(makeClient(accounts, source), "510001");
    expect(ledger[0]).toMatchObject({ no_jurnal: "J1", source_ref: "INV-1", branch_id: "b1", branch_name: "Klinik A" });
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

it("includes every journal line beyond the API row cap in financial totals and account detail", async () => {
  const manyLines = Array.from({ length: 1201 }, () => ({ ...lines[0], credit: 100 }));
  const balances = await getAccountBalances(makeClient(accounts, manyLines));
  expect(balances[0].saldo).toBe(120_100);
  expect(await getAccountLedger(makeClient(accounts, manyLines), "510001")).toHaveLength(1201);
});

describe("getAccountBalances — agregat di database (ledger_account_totals)", () => {
  function withRpc(result: { data: unknown; error: { code?: string; message?: string } | null }) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let linesRead = false;
    const base = makeClient(accounts, lines);
    const client = {
      from(table: string) { if (table === "journal_lines") linesRead = true; return base.from(table); },
      rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return Promise.resolve(result); },
    };
    return { client, calls, linesRead: () => linesRead };
  }

  it("memakai total dari RPC tanpa menarik baris jurnal", async () => {
    const t = withRpc({ data: [{ account_id: "acc-4101", debit: 0, credit: "750000.50" }], error: null });
    const bal = await getAccountBalances(t.client, { from: "2026-01-01", to: "2026-11-09", branchId: "b1" });
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(750_000.5);
    expect(t.calls).toEqual([{ name: "ledger_account_totals", args: { p_from: "2026-01-01", p_to: "2026-11-09", p_branch_ids: ["b1"] } }]);
    expect(t.linesRead()).toBe(false);
  });

  it("tanpa filter = semua null; branchId + branchIds = irisan", async () => {
    const t = withRpc({ data: [], error: null });
    await getAccountBalances(t.client);
    await getAccountBalances(t.client, { branchId: "b2", branchIds: ["b1", "b2"] });
    expect(t.calls.map((c) => c.args)).toEqual([
      { p_from: null, p_to: null, p_branch_ids: null },
      { p_from: null, p_to: null, p_branch_ids: ["b2"] },
    ]);
  });

  it("allow-list kosong / irisan kosong = nol tanpa memanggil database", async () => {
    const t = withRpc({ data: [], error: null });
    expect((await getAccountBalances(t.client, { branchIds: [] })).find((b) => b.code === "510001")?.saldo).toBe(0);
    expect((await getAccountBalances(t.client, { branchId: "b3", branchIds: ["b1"] })).find((b) => b.code === "510001")?.saldo).toBe(0);
    expect(t.calls).toHaveLength(0);
  });

  it("fungsi belum dipasang -> kembali ke pembaca lama, hasil sama", async () => {
    const t = withRpc({ data: null, error: { code: "PGRST202", message: "Could not find the function public.ledger_account_totals(p_branch_ids, p_from, p_to) in the schema cache" } });
    const bal = await getAccountBalances(t.client, {});
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(300_000);
    expect(t.linesRead()).toBe(true);
  });

  it("galat lain (mis. batas waktu) dilempar, tidak diam-diam jadi saldo nol", async () => {
    const t = withRpc({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(getAccountBalances(t.client, {})).rejects.toThrow("statement timeout");
    const lain = withRpc({ data: null, error: { code: "42883", message: "function public.other_fn(uuid) does not exist" } });
    await expect(getAccountBalances(lain.client, {})).rejects.toThrow("other_fn");
  });
});
