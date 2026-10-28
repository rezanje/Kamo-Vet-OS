import { expect, it, vi } from "vitest";
import { getDashboard } from "../dashboard";
import { mutasiHutang } from "../buku-pembantu-server";
import { bukuPembantu } from "../buku-pembantu";

vi.mock("../ledger", () => ({ getAccountBalances: vi.fn(async () => []), nilaiSeksi: vi.fn() }));
vi.mock("../kas-akun", () => ({ kodeSemuaRekening: vi.fn(async () => []) }));
type Row = Record<string, unknown>;
function client(tables: Record<string, Row[]>) {
  return { from: (name: string) => {
    let data = tables[name] ?? [];
    const query = {
      select: () => query, order: () => query,
      range: async (from: number, to: number) => ({ data: data.slice(from, to + 1), count: data.length, error: null }),
      eq: () => query, neq: () => query, in: () => query,
      is: (column: string, value: unknown) => { data = data.filter(row => row[column] === value); return query; },
      gte: (column: string, value: string) => { data = data.filter(row => String(row[column]) >= value); return query; },
      lte: (column: string, value: string) => { data = data.filter(row => String(row[column]) <= value); return query; },
      then: (resolve: (result: { data: Row[] }) => unknown) => Promise.resolve(resolve({ data })),
    };
    return query;
  } };
}
const sale = (date: string) => ({ total: 200, created_at: date + "T12:00:00+07:00", voided_at: null });
const returns = (date: string) => [
  { id: "original", total: 100, tanggal: date, voided_at: "2026-10-21T00:00:00Z" },
  { id: "replacement", total: 20, tanggal: date, voided_at: null },
];

it("nets only the replacement on the original open day, with no correction-day refund", async () => {
  const result = await getDashboard(client({ sales: [sale("2026-10-19")], sales_returns: returns("2026-10-20") }), "2026-10-21");
  expect(result.penjualan).toEqual({ total: 180, lunas: 180, belumLunas: 0 });
  expect(result.trenPenjualan.find(row => row.tanggal === "2026-10-20")?.total).toBe(-20);
  expect(result.trenPenjualan.find(row => row.tanggal === "2026-10-21")?.total).toBe(0);
});
it("keeps prior-year open-date restatement out of current-year sales but in a cross-year seven-day trend", async () => {
  const result = await getDashboard(client({ sales: [sale("2025-12-30")], sales_returns: returns("2025-12-31") }), "2026-01-02");
  expect(result.penjualan.total).toBe(0);
  expect(result.trenPenjualan.find(row => row.tanggal === "2025-12-31")?.total).toBe(-20);
  expect(result.trenPenjualan.find(row => row.tanggal === "2026-01-02")?.total).toBe(0);
});
it("does not count a cancelled return without replacement in yearly or daily sales", async () => {
  const result = await getDashboard(client({ sales: [sale("2026-10-19")], sales_returns: [returns("2026-10-20")[0]] }), "2026-10-21");
  expect(result.penjualan.total).toBe(200);
  expect(result.trenPenjualan.find(row => row.tanggal === "2026-10-20")?.total).toBe(0);
});
it("R02: nets posted clinic refunds from this year's clinic sales on the refund date", async () => {
  // Fictional: two paid clinic invoices; one refund this year (cash or finished transfer),
  // one dated last year (already in last year's figure), one dated after today (not yet).
  const result = await getDashboard(client({
    invoices: [
      { id: "inv-1", total: 300, dp_amount: 300, paid_status: "lunas", created_at: "2026-10-19T03:00:00Z", voided_at: null },
      { id: "inv-2", total: 100, dp_amount: 100, paid_status: "lunas", created_at: "2026-10-20T03:00:00Z", voided_at: null },
    ],
    clinic_refunds: [
      { id: "rf-1", invoice_id: "inv-1", total: 120.5, tanggal: "2026-10-21" },
      { id: "rf-old", invoice_id: "inv-old", total: 50, tanggal: "2025-12-31" },
      { id: "rf-future", invoice_id: "inv-2", total: 10, tanggal: "2026-10-22" },
    ],
  }), "2026-10-21");
  expect(result.penjualan).toEqual({ total: 279.5, lunas: 279.5, belumLunas: 0 });
});
it("restates supplier subledger opening balance without adding a current-year reversal", async () => {
  const db = client({
    purchase_invoices: [{ no_faktur: "INV", tanggal: "2025-12-30", total: 200, supplier_id: "supplier", suppliers: { nama: "Fiction" }, purchase_invoice_payments: [] }],
    purchase_returns: returns("2025-12-31").map(row => ({ ...row, no_retur: "RETURN", purchase_orders: { supplier_id: "supplier", suppliers: { nama: "Fiction" } } })),
  });
  const previous = await mutasiHutang(db as never, "2025-12-31");
  const current = await mutasiHutang(db as never, "2026-10-21");
  expect(bukuPembantu(previous, "2025-12-01", "2025-12-31")[0].saldoAkhir).toBe(180);
  expect(bukuPembantu(current, "2026-01-01", "2026-10-21")[0]).toMatchObject({ saldoAwal: 180, naik: 0, turun: 0, saldoAkhir: 180 });
});
