import { describe, expect, it } from "vitest";
import { loadClinicSkuDetails } from "../clinic-compound-skus";
import { loadClinicPaymentMaster } from "../clinic-payment";
import { stokGudangKlinik } from "../stok-klinik";

// Paket B: pembaca bersama stok klinik. Gudangnya harus sama dengan gudang yang dipakai
// posting tagihan klinik (`clinic_post_invoice`: gudang VET aktif tertua di cabang
// kunjungan, urut created_at, id) — bukan gudang ritel cabang yang sama, bukan cabang lain.
type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, failed = "") {
  return { from(table: string) {
    const filters: ((r: Row) => boolean)[] = []; const sorts: string[] = [];
    let start = 0; let end = 999; let count = false;
    const rows = () => {
      const list = (tables[table] ?? []).filter(r => filters.every(f => f(r)));
      for (const key of [...sorts].reverse()) list.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
      return list;
    };
    const q = {
      select(_f: string, opts?: { count: string }) { count = opts?.count === "exact"; return q; },
      eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
      in(k: string, ids: string[]) { filters.push(r => ids.includes(String(r[k]))); return q; },
      order(k: string) { sorts.push(k); return q; },
      limit(n: number) { end = n - 1; return q; },
      range(a: number, b: number) { start = a; end = b; return q; },
      maybeSingle: async () => failed === table ? { data: null, error: { message: "secret" } } : { data: rows()[0] ?? null, error: null },
      then(resolve: (v: unknown) => unknown) {
        const list = rows();
        return Promise.resolve(failed === table
          ? { data: null, count: null, error: { message: "secret" } }
          : { data: list.slice(start, end + 1), count: count ? list.length : null, error: null }).then(resolve);
      },
    };
    return q;
  } };
}

const warehouses = [
  { id: "vet-a-new", branch_id: "a", type: "VET", is_active: true, created_at: "2026-05-01" },
  { id: "vet-a-old", branch_id: "a", type: "VET", is_active: true, created_at: "2026-01-01" },
  { id: "vet-a-off", branch_id: "a", type: "VET", is_active: false, created_at: "2025-01-01" },
  { id: "retail-a", branch_id: "a", type: "RETAIL", is_active: true, created_at: "2024-01-01" },
  { id: "vet-b", branch_id: "b", type: "VET", is_active: true, created_at: "2024-01-01" },
];
const stock = [
  { id: "s1", warehouse_id: "vet-a-old", item_id: "obat", qty: 12 },
  { id: "s2", warehouse_id: "vet-a-new", item_id: "obat", qty: 300 },
  { id: "s3", warehouse_id: "vet-a-off", item_id: "obat", qty: 400 },
  { id: "s4", warehouse_id: "retail-a", item_id: "obat", qty: 500 },
  { id: "s5", warehouse_id: "vet-b", item_id: "obat", qty: 600 },
  { id: "s6", warehouse_id: "vet-b", item_id: "lain", qty: 700 },
];

describe("loadClinicSkuDetails — gudang transaksi klinik", () => {
  it("memakai gudang VET aktif tertua cabang kunjungan saja", async () => {
    const details = await loadClinicSkuDetails(database({ warehouses, stock }), ["obat", "lain"], "a");
    expect(details.warehouseId).toBe("vet-a-old");
    expect(stokGudangKlinik(details, "obat")).toBe(12);
    // Barang yang hanya punya stok di cabang lain: di gudang transaksi stoknya benar-benar 0.
    expect(stokGudangKlinik(details, "lain")).toBe(0);
  });
  it("cabang tanpa gudang klinik aktif → belum terbaca, bukan 0 dan bukan stok cabang lain", async () => {
    const details = await loadClinicSkuDetails(database({ warehouses: warehouses.filter(w => w.branch_id !== "a" || w.type !== "VET" || !w.is_active), stock }), ["obat"], "a");
    expect(details.warehouseId).toBeNull();
    expect(stokGudangKlinik(details, "obat")).toBeNull();
  });
  it("kunjungan tanpa cabang → belum terbaca", async () => {
    const details = await loadClinicSkuDetails(database({ warehouses, stock }), ["obat"], null);
    expect(stokGudangKlinik(details, "obat")).toBeNull();
  });
  it.each(["warehouses", "stock"])("gagal baca %s → halaman gagal jelas, tidak menampilkan 0", async (table) => {
    await expect(loadClinicSkuDetails(database({ warehouses, stock }, table), ["obat"], "a")).rejects.toThrow(/belum (dapat|bisa) dimuat|belum.*dimuat/);
  });
});

describe("loadClinicSkuDetails — katalog besar dibaca per gudang/cabang sekali", () => {
  const banyak = Array.from({ length: 450 }, (_, i) => `item-${String(i).padStart(3, "0")}`);
  const tables = {
    warehouses,
    stock: [...stock, { id: "s7", warehouse_id: "vet-a-old", item_id: "item-007", qty: 5 }, { id: "s8", warehouse_id: "vet-b", item_id: "item-007", qty: 99 }],
    item_units: [{ id: "u1", item_id: "item-007", unit: "box", factor: 10, sell_price: 90, buy_price: 50 }, { id: "u2", item_id: "bukan-diminta", unit: "box", factor: 2, sell_price: 1, buy_price: 1 }],
    item_branch_prices: [{ id: "p1", item_id: "item-007", unit: "pcs", sell_price: 12, branch_id: "a" }, { id: "p2", item_id: "item-007", unit: "pcs", sell_price: 77, branch_id: "b" }],
  };
  it("hasilnya sama: gudang transaksi, satuan & harga cabang hanya untuk barang yang diminta", async () => {
    const db = database(tables); const inCalls: string[] = [];
    const spy = { from(table: string) { const q = db.from(table) as unknown as Record<string, (...a: unknown[]) => unknown>; const asli = q.in; q.in = (...a: unknown[]) => { inCalls.push(table); return asli(...a); }; return q; } };
    const details = await loadClinicSkuDetails(spy, ["obat", ...banyak], "a");
    expect(details.warehouseId).toBe("vet-a-old");
    expect(stokGudangKlinik(details, "item-007")).toBe(5);
    expect(stokGudangKlinik(details, "obat")).toBe(12);
    expect(stokGudangKlinik(details, "lain")).toBe(0);
    expect(details.units.get("item-007")).toEqual([{ unit: "box", factor: 10, sell_price: 90, buy_price: 50 }]);
    expect(details.units.has("bukan-diminta")).toBe(false);
    expect(details.prices.get("item-007|pcs")).toBe(12);
    // Tidak ada lagi permintaan per 200 id.
    expect(inCalls).toEqual([]);
  });
});

describe("loadClinicPaymentMaster — stok untuk baris tambahan Pembayaran", () => {
  const items = [
    { id: "obat", code: "O1", name: "Obat", unit: "pcs", sell_price: 1000, item_type: "Persediaan", tindakan_kategori: null, is_active: true },
    { id: "konsul", code: "J1", name: "Konsultasi", unit: "kali", sell_price: 5000, item_type: "Jasa", tindakan_kategori: null, is_active: true },
  ];
  it("barang membawa stok gudang klinik cabang; jasa tidak membawa angka stok", async () => {
    const result = await loadClinicPaymentMaster(database({ items, warehouses, stock }), "a");
    expect(result.obat).toEqual([expect.objectContaining({ id: "obat", stokGudang: 12 })]);
    expect(result.jasa[0]).not.toHaveProperty("stokGudang");
  });
  it("gudang klinik cabang tidak terbaca → stok null (belum terbaca)", async () => {
    const result = await loadClinicPaymentMaster(database({ items, warehouses: [], stock }), "a");
    expect(result.obat[0]).toMatchObject({ id: "obat", stokGudang: null });
  });
});
