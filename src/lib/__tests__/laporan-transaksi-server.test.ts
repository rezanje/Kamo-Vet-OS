import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("../supabase/server", () => ({ createClient }));

import { tarikTransaksi } from "../laporan-transaksi-server";

type QueryResult = { data: unknown; error: { message: string } | null };

function query(result: QueryResult) {
  const q = {
    select: vi.fn(), gte: vi.fn(), lte: vi.fn(), limit: vi.fn(),
    is: vi.fn(), eq: vi.fn(), order: vi.fn(),
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
      branches: query({ data: [], error: null }),
    };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });
    await expect(tarikTransaksi("2026-09-24", "2026-09-24"))
      .rejects.toThrow("Gagal membaca tagihan klinik");
  });
});
