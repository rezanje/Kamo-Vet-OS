import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("../supabase/server", () => ({ createClient }));

import { tarikTransaksi } from "../laporan-transaksi-server";

type QueryResult = { data: unknown; error: { message: string } | null };

function query(result: QueryResult) {
  const q = {
    select: vi.fn(), gte: vi.fn(), lte: vi.fn(), limit: vi.fn(),
    is: vi.fn(), eq: vi.fn(), order: vi.fn(),
    range: (from: number, to: number) => Promise.resolve({ ...result, data: Array.isArray(result.data) ? result.data.slice(from, to + 1) : result.data, count: Array.isArray(result.data) ? result.data.length : null }),
    then: (resolve: (value: QueryResult) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const key of ["select", "gte", "lte", "limit", "is", "eq", "order"] as const) {
    q[key].mockReturnValue(q);
  }
  return q;
}

describe("tarikTransaksi clinic invoices", () => {
  beforeEach(() => createClient.mockReset());

  it("counts a finalized split sale once and excludes an unfinished planned sale", async () => {
    const sale = { id: "split", customer_id: "c1", total: 100000, channel: null, created_at: "2026-10-15T05:00:00Z", branches: { name: "A" },
      sale_items: [{ id: "item" }], payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }],
      sale_payments: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: "2026-10-15T05:00:01Z" };
    const tables = { sales: query({ data: [sale, { ...sale, id: "pending", payments_finalized_at: null }], error: null }),
      invoices: query({ data: [], error: null }), sales_returns: query({ data: [], error: null }), clinic_refunds: query({ data: [], error: null }), branches: query({ data: [], error: null }) };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });
    const result = await tarikTransaksi("2026-10-15", "2026-10-15");
    expect(result.trx).toHaveLength(1);
    expect(result.trx[0].omzet).toBe(100000);
  });

  it("includes nonvoid clinic revenue and item count in its branch alongside POS", async () => {
    const invoices = query({ data: [{ id: "inv-1", total: 125_000,
      created_at: "2026-09-24T04:00:00Z", visits: { customer_id: "c1", branches: { name: "Klinik A" } },
      invoice_items: [{ id: "i1" }, { id: "i2" }] }], error: null });
    const tables = {
      sales: query({ data: [{ id: "s1", customer_id: "c2", total: 25_000,
        channel: null, created_at: "2026-09-24T05:00:00Z", branches: { name: "Klinik A" },
        sale_items: [{ id: "i3" }] }], error: null }),
      invoices,
      sales_returns: query({ data: [], error: null }),
      clinic_refunds: query({ data: [], error: null }),
      branches: query({ data: [{ id: "b1", name: "Klinik A" }], error: null }),
    };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });

    const result = await tarikTransaksi("2026-09-24", "2026-09-24");
    expect(invoices.is).toHaveBeenCalledWith("voided_at", null);
    expect(result.trx).toEqual([
      expect.objectContaining({ cabang: "Klinik A", kanal: "POS", omzet: 25_000, item: 1 }),
      expect.objectContaining({ cabang: "Klinik A", kanal: "Klinik", omzet: 125_000, item: 2 }),
    ]);
  });

  it("fails closed when clinic invoices cannot be read instead of showing partial revenue", async () => {
    const tables = {
      sales: query({ data: [], error: null }),
      invoices: query({ data: null, error: { message: "query failed" } }),
      sales_returns: query({ data: [], error: null }),
      clinic_refunds: query({ data: [], error: null }),
      branches: query({ data: [], error: null }),
    };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });
    await expect(tarikTransaksi("2026-09-24", "2026-09-24"))
      .rejects.toThrow("query failed");
  });

  it("nets posted clinic refunds against their source invoice like petshop returns, keeping totals equal to the branch sum", async () => {
    const inv = (id: string, total: number, branch: string, created_at: string) => ({ id, total, created_at,
      visits: { customer_id: null, branch_id: branch, branches: { name: branch } }, invoice_items: [{ id: `${id}-1` }] });
    const tables = {
      sales: query({ data: [{ id: "s1", branch_id: "A", customer_id: null, total: 50_000, channel: null, created_at: "2026-10-20T03:00:00Z",
        branches: { name: "A" }, sale_items: [{ id: "x" }] }], error: null }),
      invoices: query({ data: [inv("inv-a", 300_000, "A", "2026-10-20T04:00:00Z"), inv("inv-b", 200_000, "B", "2026-10-21T04:00:00Z")], error: null }),
      sales_returns: query({ data: [{ id: "r1", sale_id: "s1", total: 10_000 }], error: null }),
      // Two partial refunds on inv-a (one dated after the report range) and one refund of an invoice outside the range.
      clinic_refunds: query({ data: [{ id: "f1", invoice_id: "inv-a", total: 100_000 }, { id: "f2", invoice_id: "inv-a", total: 50_000 },
        { id: "f3", invoice_id: "inv-lain", total: 999_000 }], error: null }),
      branches: query({ data: [{ id: "A", name: "A" }, { id: "B", name: "B" }], error: null }),
    };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });

    const { trx } = await tarikTransaksi("2026-10-20", "2026-10-21");
    expect(trx.map(t => [t.kanal, t.cabangId, t.tanggal, t.omzet])).toEqual([
      ["POS", "A", "2026-10-20", 40_000],
      ["Klinik", "A", "2026-10-20", 150_000],
      ["Klinik", "B", "2026-10-21", 200_000],
    ]);
    const { perCabang, perHari, rekap } = await import("../laporan-transaksi");
    const total = rekap(trx).omzet;
    expect(total).toBe(390_000);
    expect(perCabang(trx).reduce((n, b) => n + b.omzet, 0)).toBe(total);
    expect(perHari(trx).reduce((n, h) => n + h.omzet, 0)).toBe(total);
    expect(trx.filter(t => t.kanal === "Klinik").every(t => t.omzet >= 0)).toBe(true);
  });

  it("fails closed when clinic refunds cannot be read instead of overstating clinic revenue", async () => {
    const tables = {
      sales: query({ data: [], error: null }), invoices: query({ data: [], error: null }),
      sales_returns: query({ data: [], error: null }), clinic_refunds: query({ data: null, error: { message: "refund read failed" } }),
      branches: query({ data: [], error: null }),
    };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });
    await expect(tarikTransaksi("2026-10-20", "2026-10-20")).rejects.toThrow("refund read failed");
  });
});
