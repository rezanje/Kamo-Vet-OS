import { expect, it, vi } from "vitest";
import { getDashboard } from "../dashboard";

// 9 Nov 2026: Production punya 3.790 transaksi kasir dan 3.522 baris kas 7 hari, tapi API
// hanya mengembalikan 1.000 baris per permintaan — dashboard menghitung penjualan & arus kas kurang.
vi.mock("../ledger", () => ({
  getAccountBalances: vi.fn(async () => [
    { id: "kas", code: "110001", name: "Kas", type: "ASET", normal: "D", saldo: 0 },
    { id: "pend", code: "400001", name: "Pendapatan", type: "PENDAPATAN", normal: "K", saldo: 0 },
  ]),
  nilaiSeksi: vi.fn(() => 0),
}));
vi.mock("../kas-akun", () => ({ kodeSemuaRekening: vi.fn(async () => ["110001"]) }));

const API_MAX = 1000;
const sales = Array.from({ length: 2500 }, (_, i) => ({ id: `s${i}`, total: 10, created_at: "2026-11-09T03:00:00Z", voided_at: null }));

function client() {
  const rpc = vi.fn(async (_name: string, args: { p_from: string }) => ({
    data: args.p_from === "2026-11-09"
      ? [{ account_id: "kas", debit: "700", credit: "200" }, { account_id: "pend", debit: "0", credit: "999" }]
      : [],
    error: null,
  }));
  return { rpc, from(table: string) {
    const rows = table === "sales" ? sales : [];
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q,
      range: async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + API_MAX)), count: rows.length, error: null }),
      // Permintaan tanpa range dipotong batas API, seperti di Production.
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(0, API_MAX), error: null }).then(resolve) };
    return q;
  } };
}

it("reads every cashier sale past the API row limit", async () => {
  const result = await getDashboard(client(), "2026-11-09");
  expect(result.penjualan.total).toBe(25000);
  expect(result.trenPenjualan.at(-1)).toEqual({ tanggal: "2026-11-09", total: 25000 });
});

it("sums daily cash flow in the database for cash accounts only", async () => {
  const db = client();
  const result = await getDashboard(db, "2026-11-09");
  expect(db.rpc).toHaveBeenCalledTimes(7);
  expect(result.arusKas.at(-1)).toEqual({ tanggal: "2026-11-09", masuk: 700, keluar: 200 });
  expect(result.arusKas.slice(0, 6).every((d) => d.masuk === 0 && d.keluar === 0)).toBe(true);
});
