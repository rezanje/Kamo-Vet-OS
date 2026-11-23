import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";
import { rpcStrukKasirTiruan } from "@/test-support/rpc-struk-kasir-tiruan";
import { STRUK_KASIR_RPC, rentangHari } from "@/lib/laporan-struk-kasir";

// Penjualan per Tenaga Penjual, bagian Kasir: jalur baru (fungsi database) == jalur lama. Data fiktif.
const state = vi.hoisted(() => ({ klien: null as unknown }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.klien }));

import { ambilTenagaPenjual } from "./data";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sales = Array.from({ length: 240 }, (_, i) => ({
  id: id(i + 1), branch_id: i % 2 ? "cab-b" : "cab-a", customer_id: null, no_struk: `POS-${i + 1}`,
  created_at: `2026-11-${String(1 + (i % 22)).padStart(2, "0")}T05:00:00Z`, channel: null,
  total: 20000, merchant_fee_total: i % 9 === 0 ? 200 : 0, salesperson_id: i % 3 ? "pj" : "pj2", cashier_id: i % 5 ? null : "pj2",
  payment_plan: null, payments_finalized_at: null, voided_at: i % 19 === 0 ? "2026-11-30T00:00:00Z" : null,
  branches: { name: i % 2 ? "Cabang B" : "Cabang A" }, customers: { name: "Pelanggan" },
}));
const sale_items = sales.flatMap((s, i) => [
  { id: id(10_000 + i * 2), sale_id: s.id, nama: "Pakan", qty: 2, harga: 8000, item_id: null, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null },
  { id: id(10_001 + i * 2), sale_id: s.id, nama: "Pasir", qty: 1, harga: 4000, item_id: null, satuan: "pak", faktor: 2, item_discount_type: "nominal", item_discount_value: 0, promo_discount: 0, service_performers: null },
]);
const lain = {
  employees: [{ id: "pj", nama: "Penjual Satu", jabatan: "Kasir", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } },
    { id: "pj2", nama: "Penjual Dua", jabatan: "Kasir", status: "Aktif", profile_id: null, branches: { name: "Cabang B" } }],
  branches: [{ id: "cab-a", name: "Cabang A" }, { id: "cab-b", name: "Cabang B" }],
};
const sidik = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

for (const [dari, sampai, cabangId] of [["2026-11-01", "2026-11-30", ""], ["2026-11-05", "2026-11-12", ""], ["2026-11-01", "2026-11-22", "cab-b"]] as const) {
  it(`${dari}..${sampai}${cabangId ? " cabang " + cabangId : ""}: baris sama dengan jalur lama; tanpa query sales/sale_items`, async () => {
    const lama = bikinKlienTiruan({ sales, sale_items, ...lain });
    state.klien = lama.client;
    const hasilLama = await ambilTenagaPenjual({ dari, sampai, cabangId });
    const baru = bikinKlienTiruan({ sales, sale_items, ...lain }, { [STRUK_KASIR_RPC]: rpcStrukKasirTiruan({ sales, sale_items }) });
    state.klien = baru.client;
    const hasilBaru = await ambilTenagaPenjual({ dari, sampai, cabangId });
    expect(hasilLama.pesanError).toBe("");
    expect(hasilBaru.pesanError).toBe("");
    expect(hasilBaru.rows.length).toBeGreaterThan(0);
    expect(hasilBaru).toEqual(hasilLama);
    expect(sidik(hasilBaru)).toBe(sidik(hasilLama));
    expect(baru.catatanRpc.filter(p => p.nama === STRUK_KASIR_RPC)).toHaveLength(rentangHari(dari, sampai).length);
    expect(baru.catatan.filter(c => c.table === "sales" || c.table === "sale_items")).toHaveLength(0);
  });
}

it("batas waktu database pada fungsi -> pesan batas waktu (bukan pesan umum)", async () => {
  const k = bikinKlienTiruan({ sales, sale_items, ...lain }, { [STRUK_KASIR_RPC]: () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
  state.klien = k.client;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const hasil = await ambilTenagaPenjual({ dari: "2026-11-01", sampai: "2026-11-30" });
  expect(hasil.pesanError).toMatch(/batas waktu/i);
  vi.restoreAllMocks();
});
