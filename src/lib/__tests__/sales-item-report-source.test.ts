import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";

const source = Array.from({ length: 1201 }, (_, index) => ({ id: String(index), nama: "Obat", qty: 2, harga: 100, item_discount_type: "nominal", item_discount_value: 10, promo_discount: 0,
  sales: { id: `s${index}`, no_struk: `STRUK-${index}`, created_at: "2026-10-04T05:00:00Z", channel: null, total: 190, merchant_fee_total: 0, branches: { name: "Kasir A" }, customers: { name: "Pemilik" } },
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

it("allocates saved POS receipt discounts to every item before filtering the report", async () => {
  const sale = { id: "sale", no_struk: "STRUK", created_at: "2026-10-04T05:00:00Z", channel: null,
    subtotal: 300, discount: 180, total: 120, merchant_fee_total: 0,
    branches: { name: "Kasir A" }, customers: { name: "Pemilik" } };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: [
    { id: "a", nama: "Vaksin", qty: 1, harga: 100, item_discount_type: null, item_discount_value: 0, promo_discount: 0, sales: sale },
    { id: "b", nama: "Obat", qty: 1, harga: 200, item_discount_type: "nominal", item_discount_value: 60, promo_discount: 0, sales: sale },
  ] } }).client);
  const all = await ambilPenjualanBarang({ ...filters, q: "" });
  expect(all.pesanError).toBe("");
  expect(all.rows.map(row => [row.nama, row.nilai, row.diskon])).toEqual([
    ["Vaksin", 50, 50], ["Obat", 70, 130],
  ]);
  expect(all.nilaiTotal).toBe(120);
  const filtered = await ambilPenjualanBarang({ ...filters, q: "Vaksin" });
  expect(filtered.nilaiTotal).toBe(50);
});

it("keeps a fully discounted POS receipt at zero per item", async () => {
  const sale = { id: "free", no_struk: "FREE", created_at: "2026-10-04T05:00:00Z", channel: null,
    subtotal: 200, discount: 200, total: 0, merchant_fee_total: 0 };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: [
    { id: "a", nama: "Obat A", qty: 1, harga: 100, sales: sale },
    { id: "b", nama: "Obat B", qty: 1, harga: 100, sales: sale },
  ] } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "" });
  expect(result.rows.map(row => row.nilai)).toEqual([0, 0]);
  expect(result.nilaiTotal).toBe(0);
});

it("keeps merchant fees out of item revenue and allocates the last cent exactly", async () => {
  const sale = { id: "cents", no_struk: "CENTS", created_at: "2026-10-04T05:00:00Z", channel: null,
    subtotal: 0.03, discount: 0.01, total: 0.03, merchant_fee_total: 0.01 };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: ["a", "b", "c"].map(id => ({
    id, nama: `Obat ${id}`, qty: 1, harga: 0.01, sales: sale,
  })) } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => row.nilai)).toEqual([0.01, 0, 0.01]);
  expect(result.nilaiTotal).toBe(0.02);
});

it("reconciles fractional-quantity lines that round only at the receipt total", async () => {
  const sale = { id: "fraction", no_struk: "FRACTION", created_at: "2026-10-04T05:00:00Z", channel: null,
    subtotal: 0.01, discount: 0, total: 0.01, merchant_fee_total: 0 };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: ["a", "b"].map(id => ({
    id, nama: `Obat ${id}`, qty: 0.001, harga: 4, sales: sale,
  })) } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => row.nilai)).toEqual([0.01, 0]);
  expect(result.nilaiTotal).toBe(0.01);
});

it("does not publish item totals when the saved receipt exceeds its source lines", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: [{ id: "a", nama: "Obat", qty: 1, harga: 100,
    sales: { id: "broken", no_struk: "BROKEN", created_at: "2026-10-04T05:00:00Z", channel: null, total: 200, merchant_fee_total: 0 },
  }] } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "" });
  expect(result.pesanError).not.toBe("");
  expect(result.rows).toEqual([]);
  expect(result.nilaiTotal).toBe(0);
  vi.restoreAllMocks();
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
    invoice_items: [{ id: "line", compound_recipe_id: "recipe", deskripsi: "Label invoice berbeda", qty: 1, harga: 100, diskon_persen: 0, jenis: "jasa", item_id: null,
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
