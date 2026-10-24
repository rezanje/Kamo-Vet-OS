import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";

const source = Array.from({ length: 1201 }, (_, index) => ({ id: String(index), nama: "Obat", qty: 2, harga: 100, item_discount_type: "nominal", item_discount_value: 10, promo_discount: 0,
  sales: { id: `s${index}`, no_struk: `STRUK-${index}`, created_at: "2026-10-04T05:00:00Z", channel: null, branches: { name: "Kasir A" }, customers: { name: "Pemilik" } },
}));
const filters = { dari: "2026-10-01", sampai: "2026-10-04", kanal: "POS" as const, jenis: "Barang", q: "Obat" };

it("reads every source page before computing selected quantities and totals", async () => {
  const { client } = clientFixture({ tables: { sale_items: source } });
  mocks.createClient.mockResolvedValue(client);
  const result = await ambilPenjualanBarang(filters);
  expect(result.pesanError).toBe("");
  expect(result.rows).toHaveLength(1201);
  expect(result.rows.some(row => row.dokumen === "STRUK-1200")).toBe(true);
  expect(result.qtyTotal).toBe(2402);
  expect(result.nilaiTotal).toBe(1201 * 190);
});

it("rejects a silently capped source rather than exporting partial detail with totals", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: source }, serverCap: 200 }).client);
  const result = await ambilPenjualanBarang(filters);
  expect(result.pesanError).not.toBe("");
  expect(result.rows).toEqual([]);
  expect(result.nilaiTotal).toBe(0);
  vi.restoreAllMocks();
});

it.each(["medical_records", "compounding_recipes"])("fails closed when %s enrichment cannot be read", async errorTable => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.createClient.mockResolvedValue(clientFixture({ errorTable, tables: {
    invoice_items: [{ id: "line", deskripsi: "Racikan", qty: 1, harga: 100, diskon_persen: 0, jenis: "obat", item_id: null,
      invoices: { visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: {} },
    }], medical_records: [{ id: "record", visit_id: "visit" }],
  } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Racikan" });
  expect(result.pesanError).not.toBe("");
  expect(result.rows).toEqual([]);
  expect(result.nilaiTotal).toBe(0);
  vi.restoreAllMocks();
});

it("opens the exact saved clinic invoice for each report line in a visit with multiple invoices", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: {
    invoice_items: [
      { id: "first-line", deskripsi: "Konsultasi", qty: 1, harga: 100, diskon_persen: 0, jenis: "jasa", item_id: null,
        invoices: { id: "first-invoice", visit_id: "visit", invoice_no: "INV-1", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: {} } },
      { id: "second-line", deskripsi: "Konsultasi", qty: 1, harga: 200, diskon_persen: 0, jenis: "jasa", item_id: null,
        invoices: { id: "second-invoice", visit_id: "visit", invoice_no: "INV-2", created_at: "2026-10-04T06:00:00Z", paid_status: "Belum Lunas", voided_at: null, visits: {} } },
    ], medical_records: [],
  } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "Konsultasi" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => [row.dokumen, row.href])).toEqual([
    ["INV-2", "/klinik/pembayaran/visit/invoice?invoice_id=second-invoice"],
    ["INV-1", "/klinik/pembayaran/visit/invoice?invoice_id=first-invoice"],
  ]);
});

it("does not publish partial clinic totals if an invoice source ID is unavailable", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.createClient.mockResolvedValue(clientFixture({ tables: {
    invoice_items: [{ id: "line", deskripsi: "Konsultasi", qty: 1, harga: 100, diskon_persen: 0, jenis: "jasa", item_id: null,
      invoices: { visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: {} } }],
    medical_records: [],
  } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "Konsultasi" });
  expect(result.pesanError).not.toBe("");
  expect(result.rows).toEqual([]);
  expect(result.nilaiTotal).toBe(0);
  vi.restoreAllMocks();
});

it("reads saved compound recipe IDs and classifies posted racikan independently of invoice label", async () => {
  const { client, records } = clientFixture({ tables: {
    invoice_items: [{ id: "line", compound_recipe_id: "recipe", deskripsi: "Label invoice berbeda", qty: 1, harga: 100, diskon_persen: 0, jenis: "obat", item_id: "catalog-item",
      invoices: { id: "invoice", visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas", voided_at: null, visits: {} } }],
    medical_records: [],
  } });
  mocks.createClient.mockResolvedValue(client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Racikan", q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => row.nama)).toEqual(["Label invoice berbeda"]);
  expect(result.nilaiTotal).toBe(100);
  expect(records.find(record => record.table === "invoice_items" && record.method === "select")?.args[0]).toContain("compound_recipe_id");
});
