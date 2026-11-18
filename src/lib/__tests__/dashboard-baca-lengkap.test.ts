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

type Ringkas = { kasir_total: unknown; kasir_piutang: unknown; kasir_harian: unknown; klinik_total: unknown; klinik_belum: unknown };

// ringkas = hasil fungsi agregat dashboard; null = fungsinya belum terpasang (pembaca baris lama).
function client(ringkas: Ringkas | null = null) {
  const rpc = vi.fn(async (name: string, args: { p_from: string }) => name === "dashboard_penjualan_ringkas"
    ? (ringkas ? { data: ringkas, error: null }
      : { data: null, error: { code: "PGRST202", message: "Could not find the function public.dashboard_penjualan_ringkas(p_awal7, p_awal_tahun, p_hari_ini) in the schema cache" } })
    : {
    data: args.p_from === "2026-11-09"
      ? [{ account_id: "kas", debit: "700", credit: "200" }, { account_id: "pend", debit: "0", credit: "999" }]
      : [],
    error: null,
  });
  return { rpc, from(table: string) {
    const rows = table === "sales" ? sales : [];
    const q = { select: () => q, eq: () => q, is: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q,
      range: async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + API_MAX)), count: rows.length, error: null }),
      // Permintaan tanpa range dipotong batas API, seperti di Production.
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(0, API_MAX), error: null }).then(resolve) };
    return q;
  } };
}

it("reads every cashier sale past the API row limit when the summary function is not installed yet", async () => {
  const result = await getDashboard(client(), "2026-11-09");
  expect(result.penjualan.total).toBe(25000);
  expect(result.trenPenjualan.at(-1)).toEqual({ tanggal: "2026-11-09", total: 25000 });
});

it("sums daily cash flow in the database for cash accounts only", async () => {
  const db = client();
  const result = await getDashboard(db, "2026-11-09");
  expect(db.rpc.mock.calls.filter(([name]) => name === "ledger_account_totals")).toHaveLength(7);
  expect(result.arusKas.at(-1)).toEqual({ tanggal: "2026-11-09", masuk: 700, keluar: 200 });
  expect(result.arusKas.slice(0, 6).every((d) => d.masuk === 0 && d.keluar === 0)).toBe(true);
});

// 18 Nov 2026: dashboard lama sekali terbuka karena ±150.000 struk setahun ditarik 500 baris per
// permintaan. Penjualan kasir dan tagihan klinik kini dijumlah di database (satu panggilan).
it("uses the database summary without reading cashier sales, clinic invoices or their payments row by row", async () => {
  const db = client({ kasir_total: "125000.5", kasir_piutang: 25000, kasir_harian: [{ tanggal: "2026-11-08", total: 1000 }, { tanggal: "2026-11-09", total: "2500" }], klinik_total: 80000, klinik_belum: "30000" });
  const dibaca: string[] = [];
  const from = db.from;
  db.from = (table: string) => { dibaca.push(table); return from(table); };
  const result = await getDashboard(db, "2026-11-09");
  expect(dibaca).not.toContain("sales");
  expect(dibaca).not.toContain("invoices");
  expect(dibaca).not.toContain("invoice_payments");
  expect(db.rpc).toHaveBeenCalledWith("dashboard_penjualan_ringkas", { p_awal_tahun: "2026-01-01", p_awal7: "2026-11-03", p_hari_ini: "2026-11-09" });
  expect(result.penjualan).toEqual({ total: 125000.5 + 80000, lunas: 125000.5 - 25000 + 80000 - 30000, belumLunas: 25000 + 30000 });
  expect(result.trenPenjualan.slice(-2)).toEqual([{ tanggal: "2026-11-08", total: 1000 }, { tanggal: "2026-11-09", total: 2500 }]);
});

it("refuses an incomplete database summary instead of showing a wrong figure", async () => {
  await expect(getDashboard(client({ kasir_total: null, kasir_piutang: 0, kasir_harian: [], klinik_total: 0, klinik_belum: 0 }), "2026-11-09"))
    .rejects.toThrow("Ringkasan penjualan dashboard tidak lengkap");
});

it("surfaces a real database failure instead of silently falling back to the slow reader", async () => {
  const db = client();
  db.rpc.mockImplementation(async (name: string) => name === "dashboard_penjualan_ringkas"
    ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } as never
    : { data: [], error: null } as never);
  await expect(getDashboard(db, "2026-11-09")).rejects.toThrow("statement timeout");
});
