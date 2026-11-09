import { beforeEach, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";

// Kategori + sub kategori pada rincian penjualan per barang. Angka (nilai, qty, jumlah baris)
// tidak boleh berubah dibanding laporan sebelum kolom kategori ada.
const invoice = { id: "inv", visit_id: "visit", invoice_no: "INV-1", created_at: "2026-10-28T05:00:00Z",
  paid_status: "Lunas", subtotal: 175000, discount: 0, voided_at: null,
  visits: { branch_id: "b1", branches: { name: "Klinik Satu" }, customers: { name: "Pemilik" }, pets: { name: "Mimi" } } };
const bmhp = { version: 1, cost: 1500, components: [{ item_id: "kasa", name: "Kasa", qty: 3, unit: "lembar", base_qty: 3, cost: 500 }] };
const baris = (id: string, over: Record<string, unknown>) => ({ id, deskripsi: id, qty: 1, harga: 0, diskon_persen: 0, jenis: "obat",
  item_id: null, compound_recipe_id: null, bmhp_components: null, service_performers: null, invoices: invoice, ...over });
const lines = [
  baris("Operasi steril", { jenis: "jasa", item_id: "i-tind", harga: 100000, bmhp_components: bmhp }),
  baris("Obat pulang", { item_id: "i-obat", qty: 2, harga: 5000 }),
  baris("Puyer batuk", { compound_recipe_id: "r1", harga: 20000 }),
  baris("Jasa Konsultasi Poli Umum", { jenis: "jasa", harga: 30000 }),
  baris("Barang tanpa kategori", { item_id: "i-nocat", harga: 15000 }),
];
const categories = [
  { id: "c-tind", name: "TINDAKAN", parent_id: null }, { id: "c-bedah", name: "Operasi", parent_id: "c-tind" },
  { id: "c-bedah2", name: "Operasi Besar", parent_id: "c-bedah" },
  { id: "c-obat", name: "OBAT & VITAMIN", parent_id: null },
];
const items = [
  { id: "i-tind", code: "J0020", category_id: "c-bedah2" }, { id: "i-obat", code: "100904", category_id: "c-obat" },
  { id: "i-nocat", code: "X1", category_id: null },
];
const filters = { dari: "2026-10-28", sampai: "2026-10-28", kanal: "Klinik" as const, jenis: "Semua", q: "" };
const jalankan = async (options: Parameters<typeof clientFixture>[0] = {}, extra: Record<string, unknown> = {}) => {
  const fixture = clientFixture({ ...options, tables: { invoice_items: lines, item_categories: categories, items, ...options.tables } });
  mocks.createClient.mockResolvedValue(fixture.client);
  return { result: await ambilPenjualanBarang({ ...filters, ...extra }), records: fixture.records };
};
beforeEach(() => { mocks.createClient.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it("memberi tiap baris klinik kode, kategori induk huruf besar dan sub kategori", async () => {
  const { result } = await jalankan();
  expect(result.pesanError).toBe("");
  expect(result.rows.map(row => [row.nama, row.kode, row.kategori, row.subKategori])).toEqual([
    ["Barang tanpa kategori", "X1", "TANPA KATEGORI", ""],
    ["Jasa Konsultasi Poli Umum", "", "LAINNYA", ""],
    ["Obat pulang", "100904", "OBAT & VITAMIN", ""],
    ["Operasi steril", "J0020", "TINDAKAN", "Operasi"],
    ["BMHP · Kasa", "J0020", "TINDAKAN", "Operasi"],
    ["Puyer batuk", "", "RACIKAN", ""],
  ]);
});

it("angka tidak berubah: nilai, qty, dan jumlah baris sama dengan hasil lama", async () => {
  const { result } = await jalankan();
  // Hasil laporan lama untuk fixture yang sama (dihitung tangan): 100000+10000+20000+30000+15000.
  expect(result.nilaiTotal).toBe(175000);
  expect(result.qtyTotal).toBe(6);
  expect(result.rows).toHaveLength(6);
  expect(result.rows.filter(row => !row.indukId).map(row => row.nilai).sort((a, b) => a - b)).toEqual([10000, 15000, 20000, 30000, 100000]);
});

it("ringkasan per kategori berjumlah sama dengan rincian dan mengabaikan baris anak BMHP", async () => {
  const { result } = await jalankan();
  expect(result.ringkasan.totalNilai).toBe(result.nilaiTotal);
  expect(result.ringkasan.totalQty).toBe(result.qtyTotal);
  expect(result.ringkasan.totalBaris).toBe(5);
  expect(result.ringkasan.groups.map(g => [g.kategori, g.qty, g.nilai])).toEqual([
    ["LAINNYA", 1, 30000], ["OBAT & VITAMIN", 2, 10000], ["RACIKAN", 1, 20000], ["TANPA KATEGORI", 1, 15000], ["TINDAKAN", 1, 100000],
  ]);
  expect(result.ringkasan.groups.find(g => g.kategori === "TINDAKAN")!.subs).toEqual([expect.objectContaining({ subKategori: "Operasi", qty: 1, nilai: 100000 })]);
});

it("filter kategori menyaring rincian, ringkasan, dan total; pilihan kategori tetap lengkap", async () => {
  const { result } = await jalankan({}, { kategori: "tindakan" });
  expect(result.rows.map(row => row.nama)).toEqual(["Operasi steril", "BMHP · Kasa"]);
  expect(result.nilaiTotal).toBe(100000);
  expect(result.qtyTotal).toBe(1);
  expect(result.ringkasan.totalNilai).toBe(100000);
  expect(result.ringkasan.groups.map(g => g.kategori)).toEqual(["TINDAKAN"]);
  expect(result.kategoriOptions).toEqual(["LAINNYA", "OBAT & VITAMIN", "RACIKAN", "TANPA KATEGORI", "TINDAKAN"]);
  const kosong = await jalankan({}, { kategori: "GROOMING" });
  expect(kosong.result.rows).toEqual([]);
  expect(kosong.result.nilaiTotal).toBe(0);
});

it("pembacaan kategori gagal tidak menjatuhkan laporan: angka sama, kategori TANPA KATEGORI", async () => {
  const baik = (await jalankan()).result;
  for (const errorTable of ["item_categories", "items"]) {
    const { result } = await jalankan({ errorTable });
    expect(result.pesanError).toBe("");
    expect(result.rows.map(row => row.id)).toEqual(baik.rows.map(row => row.id));
    expect(result.rows.map(row => row.nilai)).toEqual(baik.rows.map(row => row.nilai));
    expect(result.nilaiTotal).toBe(baik.nilaiTotal);
    expect(result.qtyTotal).toBe(baik.qtyTotal);
    expect(result.ringkasan.totalNilai).toBe(baik.nilaiTotal);
    const per = Object.fromEntries(result.rows.filter(row => !row.indukId).map(row => [row.nama, row.kategori]));
    expect(per["Puyer batuk"]).toBe("RACIKAN");
    expect(per["Jasa Konsultasi Poli Umum"]).toBe("LAINNYA");
    expect(per["Obat pulang"]).toBe("TANPA KATEGORI");
  }
});

it("membaca kategori dan item sekali (dikelompokkan), bukan satu per baris", async () => {
  const { records } = await jalankan();
  const baca = (table: string) => records.filter(r => r.table === table && r.method === "select").length;
  expect(baca("item_categories")).toBe(1);
  expect(baca("items")).toBe(1);
  const lookup = records.find(r => r.table === "items" && r.method === "in")!;
  expect([...(lookup.args[1] as string[])].sort()).toEqual(["i-nocat", "i-obat", "i-tind"]);
});

it("kasir dan grosir juga mendapat kategori lewat item_id", async () => {
  const sale = { id: "s1", no_struk: "S-1", created_at: "2026-10-28T05:00:00Z", channel: null, subtotal: 50000, discount: 0, total: 50000, merchant_fee_total: 0,
    branch_id: "b1", branches: { name: "Kasir" }, customers: { name: "P" } };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { item_categories: categories, items,
    sale_items: [{ id: "p1", nama: "Whiskas", qty: 1, harga: 50000, item_id: "i-obat", sales: sale }] } }).client);
  const kasir = await ambilPenjualanBarang({ ...filters, kanal: "POS", jenis: "Barang" });
  expect(kasir.rows.map(row => [row.kode, row.kategori, row.subKategori])).toEqual([["100904", "OBAT & VITAMIN", ""]]);
  expect(kasir.nilaiTotal).toBe(50000);
  const faktur = { id: "f1", no_faktur: "FJ-1", branch_id: "b1", tanggal: "2026-10-28", status: "lunas", kategori: "umum", voided_on: null,
    opening_batch_id: null, replaces_invoice_id: null, branches: { name: "DC" }, customers: { name: "R" } };
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { item_categories: categories, items,
    sales_invoice_items: [{ id: "g1", nama: "Operasi", satuan: "x", qty: 2, harga: 10000, diskon: 0, hpp: null, item_id: "i-tind", sales_invoices: faktur }] } }).client);
  const grosir = await ambilPenjualanBarang({ ...filters, kanal: "Grosir", jenis: "Barang" });
  expect(grosir.rows.map(row => [row.kode, row.kategori, row.subKategori])).toEqual([["J0020", "TINDAKAN", "Operasi"]]);
  expect(grosir.nilaiTotal).toBe(20000);
  expect(grosir.ringkasan.totalNilai).toBe(20000);
});
