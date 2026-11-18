import { beforeEach, describe, expect, it, vi } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";

// Pembacaan POS/Grosir laporan Penjualan per Barang: struk/faktur sekali, item per kelompok 100 id. Data fiktif.
const state = vi.hoisted(() => ({ klien: null as unknown }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.klien }));

import { ambilPenjualanBarang } from "./data";

const JUMLAH_STRUK = 250;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const struk = Array.from({ length: JUMLAH_STRUK }, (_, i) => ({
  id: id(i + 1), branch_id: i % 2 ? "cab-b" : "cab-a", no_struk: `POS-${i + 1}`, created_at: "2026-11-10T03:00:00Z", channel: null,
  total: 30000, merchant_fee_total: 0, payment_plan: null, payments_finalized_at: null, voided_at: null,
  branches: { name: i % 2 ? "Cabang B" : "Cabang A" }, customers: { name: `Pelanggan ${i + 1}` },
}));
const itemStruk = struk.flatMap((s, i) => [
  { id: id(1000 + i * 2), sale_id: s.id, nama: "Pakan", qty: 2, harga: 10000, item_id: null, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null },
  { id: id(1001 + i * 2), sale_id: s.id, nama: "Pasir", qty: 1, harga: 10000, item_id: null, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null },
]);
const faktur = Array.from({ length: 120 }, (_, i) => ({
  id: id(5000 + i), no_faktur: `FJ-${i + 1}`, branch_id: "cab-a", customer_id: null, tanggal: "2026-11-10", dpp: 1000, ppn: 0, total: 1000,
  status: "berjalan", kategori: "umum", voided_on: null, opening_batch_id: null, replaces_invoice_id: null,
  branches: { name: "Cabang A" }, customers: { name: "Toko Fiktif" },
}));
const itemFaktur = faktur.flatMap((f, i) => [{ id: id(9000 + i), invoice_id: f.id, nama: "Pakan dus", satuan: "dus", qty: 1, harga: 1000, diskon: 0, hpp: 600, item_id: null }]);

let tiruan: ReturnType<typeof bikinKlienTiruan>;
beforeEach(() => {
  tiruan = bikinKlienTiruan({ sales: struk, sale_items: itemStruk, sales_invoices: faktur, sales_invoice_items: itemFaktur });
  state.klien = tiruan.client;
});

describe("Penjualan per Barang - sumber Kasir (POS)", () => {
  it("hasil sama dengan data: semua baris, nilai neto struk, urut waktu lalu id", async () => {
    const hasil = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-30", kanal: "POS", jenis: "Barang", q: "" });
    expect(hasil.pesanError).toBe("");
    expect(hasil.rows).toHaveLength(JUMLAH_STRUK * 2);
    expect(hasil.nilaiTotal).toBe(JUMLAH_STRUK * 30000);
    expect(hasil.qtyTotal).toBe(JUMLAH_STRUK * 3);
    const ids = hasil.rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(hasil.rows[0]).toMatchObject({ kanal: "POS", dokumen: expect.stringMatching(/^POS-/), cabang: expect.stringMatching(/^Cabang [AB]$/) });
    expect(hasil.cabangOptions.map(c => c.name)).toEqual(["Cabang A", "Cabang B"]);
  });

  it("jumlah query dibatasi: struk per halaman 500, item per 100 id struk, tanpa gabungan !inner", async () => {
    await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-30", kanal: "POS", jenis: "Barang", q: "" });
    const strukQ = tiruan.catatan.filter(c => c.table === "sales");
    const itemQ = tiruan.catatan.filter(c => c.table === "sale_items");
    expect(strukQ).toHaveLength(1);
    expect(itemQ).toHaveLength(Math.ceil(JUMLAH_STRUK / 100));
    expect(itemQ.every(c => !c.select.includes("!inner") && c.filters.some(f => f.startsWith("sale_id in (")))).toBe(true);
    expect(tiruan.catatan.length).toBeLessThanOrEqual(8);
  });

  it("saringan cabang ikut ke query struk", async () => {
    const hasil = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-30", kanal: "POS", jenis: "Barang", q: "", cabangId: "cab-a", saringCabangDiQuery: true });
    expect(hasil.rows).toHaveLength(JUMLAH_STRUK);
    expect(tiruan.catatan.find(c => c.table === "sales")?.filters).toContain("branch_id=cab-a");
  });
});

describe("Penjualan per Barang - sumber Grosir", () => {
  it("faktur sekali, item per kelompok id faktur; baris dan nilai sama dengan data", async () => {
    const hasil = await ambilPenjualanBarang({ dari: "2026-11-01", sampai: "2026-11-30", kanal: "Grosir", jenis: "Barang", q: "" });
    expect(hasil.pesanError).toBe("");
    expect(hasil.rows).toHaveLength(120);
    expect(hasil.nilaiTotal).toBe(120 * 1000);
    expect(tiruan.catatan.filter(c => c.table === "sales_invoice_items")).toHaveLength(2);
    expect(tiruan.catatan.some(c => c.select.includes("!inner"))).toBe(false);
  });
});
