import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";

// Rincian penjualan per barang: BMHP sebuah tindakan klinik tampil sebagai baris anak
// (nama, jumlah, satuan, HPP) tetapi nilainya 0 supaya omzet tidak dihitung dua kali.
const invoice = { id: "inv", visit_id: "visit", invoice_no: "INV-1", created_at: "2026-10-28T05:00:00Z",
  paid_status: "Lunas", subtotal: 110000, discount: 0, voided_at: null,
  visits: { branch_id: "b1", branches: { name: "Klinik Satu" }, customers: { name: "Pemilik" }, pets: { name: "Mimi" } } };
const bmhp = { version: 1, cost: 7500, components: [
  { item_id: "kasa", name: "Kasa steril", qty: 3, unit: "lembar", base_qty: 3, cost: 1500 },
  { item_id: "spuit", name: "Spuit 3cc", qty: 1, unit: "PCS", base_qty: 1, cost: 6000 },
] };
const lines = [
  { id: "a", deskripsi: "Operasi steril", qty: 1, harga: 100000, diskon_persen: 0, jenis: "obat",
    item_id: "tindakan", compound_recipe_id: null, bmhp_components: bmhp, service_performers: null, invoices: invoice },
  { id: "b", deskripsi: "Obat pulang", qty: 2, harga: 5000, diskon_persen: 0, jenis: "obat",
    item_id: "obat", compound_recipe_id: null, bmhp_components: null, service_performers: null, invoices: invoice },
];
const filters = { dari: "2026-10-28", sampai: "2026-10-28", kanal: "Klinik" as const, jenis: "Semua", q: "" };
const jalankan = async (tables = { invoice_items: lines }) => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables }).client);
  return ambilPenjualanBarang(filters);
};

it("lists each BMHP material under its procedure line at zero revenue", async () => {
  const result = await jalankan();
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => [row.nama, row.qty, row.satuan, row.hpp, row.nilai])).toEqual([
    ["Operasi steril", 1, undefined, undefined, 100000],
    ["BMHP · Kasa steril", 3, "lembar", 1500, 0],
    ["BMHP · Spuit 3cc", 1, "PCS", 6000, 0],
    ["Obat pulang", 2, undefined, undefined, 10000],
  ]);
  // Baris anak menempel pada induknya dan dapat dikenali sebagai turunan.
  expect(result.rows.map(row => row.indukId)).toEqual([undefined, "klinik-a", "klinik-a", undefined]);
});

it("keeps report totals identical with and without the BMHP child rows", async () => {
  const tanpa = await jalankan({ invoice_items: lines.map(row => ({ ...row, bmhp_components: null })) });
  const dengan = await jalankan();
  expect(dengan.nilaiTotal).toBe(tanpa.nilaiTotal);
  expect(dengan.qtyTotal).toBe(tanpa.qtyTotal);
  expect(dengan.nilaiTotal).toBe(110000);
  expect(dengan.qtyTotal).toBe(3);
  expect(tanpa.rows).toHaveLength(2);
  expect(dengan.rows).toHaveLength(4);
});

it("drops the child rows when their procedure is filtered out", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: lines } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "Obat pulang" });
  expect(result.rows.map(row => row.nama)).toEqual(["Obat pulang"]);
  expect(result.nilaiTotal).toBe(10000);
});
