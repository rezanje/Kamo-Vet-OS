import { beforeEach, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";

const faktur = (over: Record<string, unknown> = {}) => ({
  id: "fj4", no_faktur: "FJ.2026.10.00004", branch_id: "dc", tanggal: "2026-10-29",
  status: "lunas", kategori: "umum", voided_on: null, opening_batch_id: null, replaces_invoice_id: null,
  branches: { name: "DC" }, customers: { name: "Reseller A" }, ...over,
});
const baris = (id: string, over: Record<string, unknown> = {}) => ({
  id, nama: "Aatas Can 400g Tuna", satuan: "pcs", qty: 3, harga: 350_000, diskon: 0,
  hpp: 724_000, item_id: "i1", sales_invoices: faktur(), ...over,
});
const filters = { dari: "2026-10-01", sampai: "2026-10-31", kanal: "Grosir" as const, jenis: "Barang", q: "" };

beforeEach(() => mocks.createClient.mockReset());

it("menampilkan baris faktur grosir lengkap dengan qty, nilai neto, dan modal dari pengiriman", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sales_invoice_items: [baris("a")] } }).client);
  const result = await ambilPenjualanBarang(filters);
  expect(result.pesanError).toBe("");
  expect(result.rows).toEqual([expect.objectContaining({
    kanal: "Grosir", jenis: "Barang", dokumen: "FJ.2026.10.00004", href: "/penjualan/faktur/fj4",
    cabang: "DC", cabangId: "dc", pelanggan: "Reseller A", satuan: "pcs",
    qty: 3, harga: 350_000, diskon: 0, nilai: 1_050_000, hpp: 724_000, status: "Lunas",
  })]);
  expect(result.nilaiTotal).toBe(1_050_000);
  expect(result.qtyTotal).toBe(3);
});

it("mengurangi diskon baris dari nilai dan menandai faktur berjalan sebagai belum lunas", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sales_invoice_items: [
    baris("a", { qty: 2, harga: 15_000, diskon: 2_500, hpp: null, sales_invoices: faktur({ status: "berjalan" }) }),
  ] } }).client);
  const result = await ambilPenjualanBarang(filters);
  expect(result.rows.map(row => [row.nilai, row.hpp, row.status])).toEqual([[27_500, undefined, "Belum lunas"]]);
  expect(result.nilaiTotal).toBe(27_500);
});

it("membuang baris faktur batal, faktur yang sudah diganti koreksi, saldo awal, dan selisih stok opname", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { sales_invoice_items: [
    baris("a1", { sales_invoices: faktur({ id: "hidup" }) }),
    baris("a2", { sales_invoices: faktur({ id: "batal", status: "batal", voided_on: "2026-10-29" }) }),
    baris("a3", { sales_invoices: faktur({ id: "lama" }) }),
    baris("a4", { sales_invoices: faktur({ id: "pengganti", replaces_invoice_id: "lama" }) }),
    baris("a5", { sales_invoices: faktur({ id: "saldo", opening_batch_id: "batch" }) }),
    baris("a6", { sales_invoices: faktur({ id: "opname", kategori: "selisih_stok" }) }),
  ] } }).client);
  const result = await ambilPenjualanBarang(filters);
  expect(result.rows.map(row => row.id)).toEqual(["grosir-a1", "grosir-a4"]);
  expect(result.nilaiTotal).toBe(2 * 1_050_000);
});

it("memakai tanggal faktur WIB sebagai batas periode dan menyaring per cabang yang dipilih", async () => {
  const { client, records } = clientFixture({ tables: { sales_invoice_items: [
    baris("dalam"),
    baris("sebelum", { sales_invoices: faktur({ id: "f0", tanggal: "2026-09-30" }) }),
    baris("sesudah", { sales_invoices: faktur({ id: "f9", tanggal: "2026-11-01" }) }),
    baris("cabang-lain", { sales_invoices: faktur({ id: "fp", branch_id: "pdry", branches: { name: "Panduraya" } }) }),
  ] } });
  mocks.createClient.mockResolvedValue(client);
  const semua = await ambilPenjualanBarang(filters);
  expect(semua.rows.map(row => row.id)).toEqual(["grosir-cabang-lain", "grosir-dalam"]);
  expect(records.some(call => call.table === "sales_invoice_items" && call.method === "gte"
    && call.args[0] === "sales_invoices.tanggal" && call.args[1] === "2026-10-01")).toBe(true);
  const satuCabang = await ambilPenjualanBarang({ ...filters, cabangId: "dc" });
  expect(satuCabang.rows.map(row => row.cabangId)).toEqual(["dc"]);
  expect(satuCabang.nilaiTotal).toBe(1_050_000);
});

it("tidak membaca faktur grosir ketika sumber yang dipilih kasir atau klinik", async () => {
  const { client, records } = clientFixture({ tables: { sale_items: [] } });
  mocks.createClient.mockResolvedValue(client);
  await ambilPenjualanBarang({ ...filters, kanal: "POS" });
  expect(records.some(call => call.table === "sales_invoice_items")).toBe(false);
});
