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
