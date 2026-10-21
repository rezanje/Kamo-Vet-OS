import { describe, expect, it, vi } from "vitest";
import { getDashboard } from "../dashboard";
vi.mock("../ledger", () => ({ getAccountBalances: vi.fn(async () => []), nilaiSeksi: vi.fn() }));
vi.mock("../kas-akun", () => ({ kodeSemuaRekening: vi.fn(async () => []) }));
type Invoice = { id: string; tanggal: string; total: number; status: string; voided_on: string | null; carried_paid: number };
type Receipt = { id: string; invoice_id: string; tanggal: string; jumlah: number };
const invoice = (id: string, tanggal: string, total: number, voided_on: string | null = null, carried_paid = 0): Invoice => ({ id, tanggal, total, status: voided_on ? "batal" : "berjalan", voided_on, carried_paid });
const receipt = (invoice_id: string, tanggal: string, jumlah: number): Receipt => ({ id: `receipt-${invoice_id}-${tanggal}`, invoice_id, tanggal, jumlah });
function client(invoices: Invoice[], receipts: Receipt[] = []) {
  return { from(table: string) {
    let rows: Record<string, unknown>[] = table === "sales_invoices" ? invoices : table === "sales_receipts" ? receipts : [];
    const result = () => ({ data: rows, error: null, count: rows.length });
    const q = { select: () => q, in: () => q, order: () => q, eq: () => q, is: () => q,
      neq: (column: string, value: unknown) => { rows = rows.filter(row => row[column] !== value); return q; },
      gte: (column: string, value: string) => { rows = rows.filter(row => String(row[column]) >= value); return q; },
      lte: (column: string, value: string) => { rows = rows.filter(row => String(row[column]) <= value); return q; },
      range: async (from: number, to: number) => ({ ...result(), data: rows.slice(from, to + 1) }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  } };
}
const day = (result: Awaited<ReturnType<typeof getDashboard>>, date: string) => result.trenPenjualan.find(d => d.tanggal === date)?.total;
describe("wholesale dashboard preserves dated sales while settling active invoices", () => {
  it("records a prior-year source and a new-year reversal plus replacement on their own dates", async () => {
    const db = client([invoice("source", "2025-12-31", 100, "2026-01-01"), invoice("replacement", "2026-01-01", 80)]);
    const result = await getDashboard(db, "2026-01-01");
    expect(result.penjualan).toEqual({ total: -20, lunas: 0, belumLunas: 80 });
    expect(day(result, "2025-12-31")).toBe(100);
    expect(day(result, "2026-01-01")).toBe(-20);
  });
  it("preserves the source sale and receivable when viewed before its later correction", async () => {
    const result = await getDashboard(client([invoice("source", "2025-12-31", 100, "2026-01-01"), invoice("replacement", "2026-01-01", 80)]), "2025-12-31");
    expect(result.penjualan).toEqual({ total: 100, lunas: 0, belumLunas: 100 });
    expect(day(result, "2025-12-31")).toBe(100);
  });
  it("preserves each day across a same-year replacement", async () => {
    const result = await getDashboard(client([invoice("source", "2026-10-20", 100, "2026-10-21"), invoice("replacement", "2026-10-21", 80)]), "2026-10-21");
    expect(result.penjualan.total).toBe(80);
    expect(day(result, "2026-10-20")).toBe(100);
    expect(day(result, "2026-10-21")).toBe(-20);
  });
  it("shows cancellation without replacement as a negative correction-day sale, with no active paid/unpaid balance", async () => {
    const result = await getDashboard(client([invoice("source", "2026-10-20", 100, "2026-10-21")], [receipt("source", "2026-10-20", 40)]), "2026-10-21");
    expect(result.penjualan).toEqual({ total: 0, lunas: 0, belumLunas: 0 });
    expect(day(result, "2026-10-20")).toBe(100);
    expect(day(result, "2026-10-21")).toBe(-100);
  });
  it("keeps prior-year cancellation negative in the current year without treating preserved payment as new sales", async () => {
    const result = await getDashboard(client([invoice("source", "2025-12-31", 100, "2026-01-01")], [receipt("source", "2025-12-31", 40)]), "2026-01-01");
    expect(result.penjualan).toEqual({ total: -100, lunas: 0, belumLunas: 0 });
    expect(day(result, "2026-01-01")).toBe(-100);
  });
  it("counts carried and new payments once on the active replacement, independently of cross-year sales", async () => {
    const result = await getDashboard(client([invoice("source", "2025-12-31", 100, "2026-01-01"), invoice("replacement", "2026-01-01", 80, null, 40)], [receipt("source", "2025-12-31", 40), receipt("replacement", "2026-01-01", 10), receipt("replacement", "2026-01-02", 5)]), "2026-01-01");
    expect(result.penjualan).toEqual({ total: -20, lunas: 50, belumLunas: 30 });
  });
  it("keeps current outstanding on an active prior-year invoice without inventing this-year sales", async () => {
    const result = await getDashboard(client([invoice("old-active", "2025-12-15", 90)], [receipt("old-active", "2025-12-20", 20)]), "2026-01-01");
    expect(result.penjualan).toEqual({ total: 0, lunas: 20, belumLunas: 70 });
  });
  it("retains each source and reversal in a correction chain and excludes undated legacy cancellations", async () => {
    const rows = [invoice("first", "2026-10-19", 100, "2026-10-20"), invoice("second", "2026-10-20", 80, "2026-10-21", 40), invoice("third", "2026-10-21", 90, null, 40), { ...invoice("legacy-cancelled", "2026-10-19", 300), status: "batal" }];
    const result = await getDashboard(client(rows, [receipt("first", "2026-10-19", 40), receipt("third", "2026-10-21", 5)]), "2026-10-21");
    expect(result.penjualan).toEqual({ total: 90, lunas: 45, belumLunas: 45 });
    expect(day(result, "2026-10-19")).toBe(100);
    expect(day(result, "2026-10-20")).toBe(-20);
    expect(day(result, "2026-10-21")).toBe(10);
  });
});
