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

it("filters item revenue by saved branch ID even when branch names match", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sale_items: ["b1", "b2"].map(branchId => ({
    id: `line-${branchId}`, nama: "Obat", qty: 1, harga: 100,
    sales: { id: `sale-${branchId}`, branch_id: branchId, no_struk: `STRUK-${branchId}`,
      created_at: "2026-10-04T05:00:00Z", channel: null, total: 100, merchant_fee_total: 0,
      branches: { name: "Cabang bernama sama" }, customers: { name: "Pemilik" } },
  })) } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "", cabangId: "b2" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => row.dokumen)).toEqual(["STRUK-b2"]);
  expect(result.nilaiTotal).toBe(100);
  expect(result.cabangOptions).toEqual([{ id: "b1", name: "Cabang bernama sama" }, { id: "b2", name: "Cabang bernama sama" }]);
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
        invoices: { id: "first-invoice", visit_id: "visit", invoice_no: "INV-1", created_at: "2026-10-04T05:00:00Z", subtotal: 100, discount: 0, paid_status: "Lunas", voided_at: null, visits: {} } },
      { id: "second-line", deskripsi: "Konsultasi", qty: 1, harga: 200, diskon_persen: 0, jenis: "jasa", item_id: null,
        invoices: { id: "second-invoice", visit_id: "visit", invoice_no: "INV-2", created_at: "2026-10-04T06:00:00Z", subtotal: 200, discount: 0, paid_status: "Belum Lunas", voided_at: null, visits: {} } },
    ], medical_records: [],
  } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "Konsultasi" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => [row.dokumen, row.href])).toEqual([
    ["INV-2", "/klinik/pembayaran/visit/invoice?invoice_id=second-invoice"],
    ["INV-1", "/klinik/pembayaran/visit/invoice?invoice_id=first-invoice"],
  ]);
});

it("allocates clinic invoice discounts over its posted item lines before filtering", async () => {
  const invoice = { id: "clinic-invoice", visit_id: "visit", invoice_no: "INV-NET", created_at: "2026-10-04T05:00:00Z",
    paid_status: "Lunas", voided_at: null, subtotal: 200, discount: 100, tax: 11, total: 111, visits: {} };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: [
    { id: "a", deskripsi: "Konsultasi", qty: 1, harga: 100, diskon_persen: 0, jenis: "jasa", item_id: null, invoices: invoice },
    { id: "b", deskripsi: "Tindakan", qty: 1, harga: 200, diskon_persen: 50, jenis: "jasa", item_id: null, invoices: invoice },
  ], medical_records: [] } }).client);
  const all = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "" });
  expect(all.pesanError).toBe("");
  expect(all.rows.map(row => [row.nama, row.nilai, row.diskon])).toEqual([
    ["Konsultasi", 50, 50], ["Tindakan", 50, 150],
  ]);
  expect(all.nilaiTotal).toBe(100);
  expect((await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "Konsultasi" })).nilaiTotal).toBe(50);
});

it("keeps every item of a fully discounted clinic invoice at zero before tax", async () => {
  const invoice = { id: "free-clinic", visit_id: "visit", invoice_no: "INV-FREE", created_at: "2026-10-04T05:00:00Z",
    paid_status: "Lunas", voided_at: null, subtotal: 200, discount: 200, total: 0, visits: {} };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: ["a", "b"].map(id => ({
    id, deskripsi: `Tindakan ${id}`, qty: 1, harga: 100, diskon_persen: 0, jenis: "jasa", item_id: null, invoices: invoice,
  })), medical_records: [] } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => row.nilai)).toEqual([0, 0]);
  expect(result.nilaiTotal).toBe(0);
});

it("uses exact clinic line decimals when an aggregate half-cent rounds up", async () => {
  const invoice = { id: "half-cent", visit_id: "visit", invoice_no: "INV-CENTS", created_at: "2026-10-04T05:00:00Z",
    paid_status: "Lunas", voided_at: null, subtotal: 0.04, discount: 0, total: 0.04, visits: {} };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: [{
    id: "a", deskripsi: "Jasa kecil", qty: 1, harga: 0.05, diskon_persen: 30, jenis: "jasa", item_id: null, invoices: invoice,
  }], medical_records: [] } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "" });
  expect(result.pesanError).toBe("");
  expect(result.nilaiTotal).toBe(0.04);
});

it("keeps the customer-paid DEMO admin fee whole while discounting only clinical lines", async () => {
  const invoice = { id: "demo-invoice", visit_id: "visit", invoice_no: "INV-DEMO", created_at: "2026-10-04T05:00:00Z",
    paid_status: "Lunas", voided_at: null, subtotal: 110, discount: 50, total: 60, visits: {} };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: {
    invoice_items: [
      { id: "service", deskripsi: "Vaksin", qty: 1, harga: 100, diskon_persen: 0, jenis: "jasa", item_id: null, invoices: invoice },
      { id: "fee", deskripsi: "Admin pembayaran DEMO", qty: 1, harga: 10, diskon_persen: 0, jenis: "jasa", item_id: null, invoices: invoice },
    ],
    clinic_demo_invoice_snapshots: [{ invoice_id: "demo-invoice", fee_amount: 10, fee_bearer: "customer" }], medical_records: [],
  } }).client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Jasa", q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => [row.nama, row.nilai])).toEqual([["Vaksin", 50]]);
  expect(result.nilaiTotal).toBe(50);
  const admin = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Biaya Admin", q: "" });
  expect(admin.rows.map(row => [row.nama, row.nilai, row.pelaksana])).toEqual([["Admin pembayaran DEMO", 10, "—"]]);
  expect(admin.nilaiTotal).toBe(10);
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
      invoices: { id: "invoice", visit_id: "visit", invoice_no: "INV", created_at: "2026-10-04T05:00:00Z", subtotal: 100, discount: 0, paid_status: "Lunas", voided_at: null, visits: {} } }],
    medical_records: [],
  } });
  mocks.createClient.mockResolvedValue(client);
  const result = await ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis: "Racikan", q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => row.nama)).toEqual(["Label invoice berbeda"]);
  expect(result.nilaiTotal).toBe(100);
  expect(records.find(record => record.table === "invoice_items" && record.method === "select")?.args[0]).toContain("compound_recipe_id");
});

it("R01: shows a mixed posted clinic invoice whole, once per line, with 50%/100% discounts and saved performers only", async () => {
  const visits = { branch_id: "b1", branches: { name: "Klinik A" } };
  const invoice = { id: "mix", visit_id: "v1", invoice_no: "INV-MIX", created_at: "2026-10-04T05:00:00Z", paid_status: "Lunas",
    voided_at: null, subtotal: 230, discount: 30, visits };
  const voided = { ...invoice, id: "void", invoice_no: "INV-VOID", voided_at: "2026-10-04T06:00:00Z" };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: [
    { id: "obat", deskripsi: "Amoxicillin", qty: 2, harga: 50, diskon_persen: 50, jenis: "obat", item_id: "i-obat", invoices: invoice },
    { id: "racikan", deskripsi: "Racikan batuk", qty: 1, harga: 100, diskon_persen: 0, jenis: "obat", item_id: null, compound_recipe_id: "rc1", invoices: invoice },
    { id: "konsultasi", deskripsi: "Jasa Konsultasi Umum", qty: 1, harga: 80, diskon_persen: 0, jenis: "jasa", item_id: null,
      service_performers: { doctor_id: "doc-1", doctor_name: "drh Fiksi" }, invoices: invoice },
    { id: "ranap", deskripsi: "Rawat inap kandang", qty: 2, harga: 150, diskon_persen: 100, jenis: "jasa", item_id: "i-ranap", invoices: invoice },
    { id: "void-line", deskripsi: "Jasa Konsultasi Umum", qty: 1, harga: 80, diskon_persen: 0, jenis: "jasa", item_id: null,
      service_performers: { doctor_id: "doc-1", doctor_name: "drh Fiksi" }, invoices: voided },
  ], medical_records: [] } }).client);
  const read = (jenis: string, pelaksanaId = "") => ambilPenjualanBarang({ ...filters, kanal: "Klinik", jenis, q: "", pelaksanaId });
  const all = await read("Semua");
  expect(all.pesanError).toBe("");
  // Each posted line once; the voided invoice is not counted; the lines reconcile to subtotal − invoice discount.
  expect(all.rows.map(row => row.id).sort()).toEqual(["klinik-konsultasi", "klinik-obat", "klinik-racikan", "klinik-ranap"]);
  expect(new Set(all.rows.map(row => row.dokumen))).toEqual(new Set(["INV-MIX"]));
  expect(Math.round(all.nilaiTotal * 100)).toBe(20000);
  const value = (id: string) => all.rows.find(row => row.id === `klinik-${id}`)!;
  expect(value("ranap").nilai).toBe(0);
  expect(value("ranap").diskon).toBe(300);
  expect(value("obat").nilai).toBeLessThan(50);
  expect(value("obat").jenis).toBe("Obat");
  expect(value("racikan").jenis).toBe("Racikan");
  // The single-type views partition the same lines: no line twice, none missing, same total.
  const parts = await Promise.all(["Obat", "Racikan", "Jasa", "Biaya Admin"].map(jenis => read(jenis)));
  const ids = parts.flatMap(part => part.rows.map(row => row.id));
  expect(ids.sort()).toEqual(all.rows.map(row => row.id).sort());
  expect(Math.round(parts.reduce((sum, part) => sum + part.nilaiTotal, 0) * 100)).toBe(20000);
  // Performer basis comes only from the saved snapshot: the stay line without one is labelled as unrecorded,
  // gets no guessed actor and is not selectable under any performer.
  expect(all.pelaksanaOptions).toEqual([{ id: "doc-1", nama: "Dokter: drh Fiksi" }]);
  expect(value("ranap").pelaksana).toBe("Pelaksana per baris belum tercatat (data lama)");
  expect(value("ranap").pelaksanaIds).toEqual([]);
  const doctor = await read("Semua", "doc-1");
  expect(doctor.rows.map(row => row.id)).toEqual(["klinik-konsultasi"]);
});
