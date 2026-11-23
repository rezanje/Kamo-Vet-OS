import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";

// Retur kasir pada Penjualan per Tenaga Penjual: retur sedikit -> dibaca sekali lalu disaring ke struk laporan; retur banyak -> jalur lama
// per kelompok 100 id struk. Kedua jalur HARUS memberi hasil sama persis. Data fiktif.
const state = vi.hoisted(() => ({ klien: null as unknown }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.klien }));

import { ambilTenagaPenjual } from "./data";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sales = Array.from({ length: 240 }, (_, i) => ({
  id: id(i + 1), branch_id: "cab-a", customer_id: null, no_struk: `POS-${i + 1}`,
  created_at: `2026-11-${String(1 + (i % 22)).padStart(2, "0")}T05:00:00Z`, channel: null,
  total: 20000, merchant_fee_total: 0, salesperson_id: i % 3 ? "pj" : "pj2", cashier_id: null,
  payment_plan: null, payments_finalized_at: null, voided_at: null, branches: { name: "Cabang A" }, customers: { name: "Pelanggan" },
}));
const sale_items = sales.flatMap((s, i) => [
  { id: id(10_000 + i * 2), sale_id: s.id, nama: "Pakan", qty: 2, harga: 8000, item_id: null, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null },
  { id: id(10_001 + i * 2), sale_id: s.id, nama: "Pasir", qty: 1, harga: 4000, item_id: null, satuan: "pak", faktor: 2, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null },
]);
const retur = (n: number, saleIndex: number) => ({
  id: id(50_000 + n), sale_id: id(saleIndex + 1), tanggal: "2026-11-25", voided_at: null,
  sales_return_items: [{ id: id(60_000 + n), source_line_id: id(10_000 + saleIndex * 2), nama: "Pakan", qty: 1, harga: 8000, selected_qty: null, satuan: "pcs" }],
});
// 7 retur nyata pada struk laporan (urutan id tidak sama dengan urutan struk).
const returNyata = [200, 5, 41, 99, 150, 7, 239].map((s, n) => retur(n, s));
const lain = {
  employees: [{ id: "pj", nama: "Penjual Satu", jabatan: "Kasir", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } },
    { id: "pj2", nama: "Penjual Dua", jabatan: "Kasir", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } }],
  branches: [{ id: "cab-a", name: "Cabang A" }],
};
// Pengisi: retur milik struk lain (di luar laporan) — membuat jumlah retur > 500 sehingga jalur per kelompok dipilih.
const pengisi = Array.from({ length: 600 }, (_, n) => ({ ...retur(1000 + n, 1000 + n), sale_id: id(900_000 + n) }));
const sidik = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const jalankan = async (returns: unknown[]) => {
  const k = bikinKlienTiruan({ sales, sale_items, sales_returns: returns as Record<string, unknown>[], ...lain });
  state.klien = k.client;
  return { hasil: await ambilTenagaPenjual({ dari: "2026-11-01", sampai: "2026-11-22" }), k };
};

it("retur sedikit (dibaca sekali) == retur banyak (per kelompok): hasil sama, retur benar mengurangi netto", async () => {
  const kosong = await jalankan([]);
  const sedikit = await jalankan(returNyata);
  const banyak = await jalankan([...returNyata, ...pengisi]);
  for (const x of [kosong, sedikit, banyak]) expect(x.hasil.pesanError).toBe("");
  expect(sedikit.hasil).toEqual(banyak.hasil);
  expect(sidik(sedikit.hasil)).toBe(sidik(banyak.hasil));
  // Retur mengurangi netto dari struk asalnya: 7 retur x Rp8.000.
  const netto = (h: typeof kosong.hasil) => h.rows.reduce((a, r) => a + r.netto, 0);
  expect(netto(kosong.hasil) - netto(sedikit.hasil)).toBe(7 * 8000);
  // Jalur: sedikit/kosong tidak memakai saringan `sale_id in`; banyak memakainya per kelompok 100 struk.
  const q = (x: typeof kosong) => x.k.catatan.filter(c => c.table === "sales_returns");
  expect(q(sedikit).every(c => !c.filters.some(f => f.startsWith("sale_id in")))).toBe(true);
  expect(q(sedikit).length).toBeLessThanOrEqual(2);
  expect(q(kosong).length).toBeLessThanOrEqual(2);
  expect(q(banyak).filter(c => c.filters.some(f => f.startsWith("sale_id in ("))).length).toBe(Math.ceil(240 / 100));
});

it("retur dibatalkan tidak dihitung di kedua jalur", async () => {
  const batal = [{ ...retur(777, 3), voided_at: "2026-11-26T00:00:00Z" }];
  const a = await jalankan([...returNyata, ...batal]);
  const b = await jalankan([...returNyata, ...batal, ...pengisi]);
  const c = await jalankan(returNyata);
  expect(a.hasil).toEqual(c.hasil);
  expect(b.hasil).toEqual(c.hasil);
});
