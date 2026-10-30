import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("../supabase/server", () => ({ createClient }));

import { tarikTransaksi } from "../laporan-transaksi-server";
import { perCabang, perKanal } from "../laporan-transaksi";

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
      invoices: query({ data: [], error: null }), sales_invoices: query({ data: [], error: null }),
      sales_returns: query({ data: [], error: null }), branches: query({ data: [], error: null }) };
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
      sales_invoices: query({ data: [], error: null }),
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
      sales_invoices: query({ data: [], error: null }),
      sales_returns: query({ data: [], error: null }),
      branches: query({ data: [], error: null }),
    };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });
    await expect(tarikTransaksi("2026-09-24", "2026-09-24"))
      .rejects.toThrow("query failed");
  });
});

describe("tarikTransaksi faktur grosir", () => {
  beforeEach(() => createClient.mockReset());

  const faktur = (over: Record<string, unknown>) => ({
    id: "f1", no_faktur: "FJ.2026.10.00004", branch_id: "dc", customer_id: "reseller",
    tanggal: "2026-10-29", dpp: 1_050_000, ppn: 0, total: 1_050_000, status: "lunas",
    kategori: "umum", voided_on: null, opening_batch_id: null, replaces_invoice_id: null,
    branches: { name: "DC" }, sales_invoice_items: [{ id: "l1" }, { id: "l2" }], ...over,
  });

  function jalankan(sales_invoices: ReturnType<typeof query>) {
    const tables = { sales: query({ data: [], error: null }), invoices: query({ data: [], error: null }),
      sales_invoices, sales_returns: query({ data: [], error: null }), branches: query({ data: [], error: null }) };
    createClient.mockResolvedValue({ from: (table: keyof typeof tables) => tables[table] });
    return tables;
  }

  it("menghitung faktur grosir sebagai kanal sendiri lengkap dengan cabang dan pelanggannya", async () => {
    jalankan(query({ data: [faktur({})], error: null }));
    const result = await tarikTransaksi("2026-10-29", "2026-10-29");
    expect(result.trx).toEqual([expect.objectContaining({
      kanal: "Grosir", tanggal: "2026-10-29", cabang: "DC", cabangId: "dc",
      customerId: "reseller", omzet: 1_050_000, item: 2,
    })]);
  });

  it("menyaring faktur grosir memakai tanggal faktur WIB, bukan jam pembuatannya", async () => {
    const sales_invoices = query({ data: [], error: null });
    const tables = jalankan(sales_invoices);
    await tarikTransaksi("2026-10-29", "2026-10-29");
    expect(sales_invoices.gte).toHaveBeenCalledWith("tanggal", "2026-10-29");
    expect(sales_invoices.lte).toHaveBeenCalledWith("tanggal", "2026-10-29");
    // Struk kasir tetap memakai batas jam WIB karena waktunya tersimpan sebagai timestamp.
    expect(tables.sales.gte).toHaveBeenCalledWith("created_at", "2026-10-29T00:00:00+07:00");
  });

  it("membuang faktur batal, faktur yang sudah diganti koreksi, saldo awal, dan selisih stok opname", async () => {
    jalankan(query({ data: [
      faktur({ id: "hidup", total: 350_000 }),
      faktur({ id: "batal", status: "batal", voided_on: "2026-10-29", total: 999 }),
      faktur({ id: "lama", total: 777 }),
      faktur({ id: "pengganti", replaces_invoice_id: "lama", total: 15_000 }),
      faktur({ id: "saldo", opening_batch_id: "b", total: 500 }),
      faktur({ id: "opname", kategori: "selisih_stok", total: 7_586_000 }),
    ], error: null }));
    const result = await tarikTransaksi("2026-10-29", "2026-10-29");
    expect(result.trx.map(t => t.omzet).sort((a, b) => a - b)).toEqual([15_000, 350_000]);
  });

  it("memisahkan omzet grosir per cabang sehingga saringan cabang laporan tetap tepat", async () => {
    jalankan(query({ data: [
      faktur({ id: "a", branch_id: "dc", branches: { name: "DC" }, total: 1_050_000 }),
      faktur({ id: "b", branch_id: "pdry", branches: { name: "Panduraya" }, total: 14_000 }),
    ], error: null }));
    const result = await tarikTransaksi("2026-10-29", "2026-10-29");
    expect(perKanal(result.trx)).toEqual({ POS: 0, Online: 0, Klinik: 0, Grosir: 2 });
    expect(perCabang(result.trx).map(b => [b.cabangId, b.omzet]))
      .toEqual([["dc", 1_050_000], ["pdry", 14_000]]);
  });

  it("gagal terbuka-tutup ketika faktur grosir tidak terbaca, bukan melaporkan omzet sebagian", async () => {
    jalankan(query({ data: null, error: { message: "grosir failed" } }));
    await expect(tarikTransaksi("2026-10-29", "2026-10-29")).rejects.toThrow("grosir failed");
  });
});
