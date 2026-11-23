import { beforeEach, expect, it, vi } from "vitest";
import { bikinKlienTiruan } from "@/test-support/klien-tiruan";

// Laporan Tenaga Penjual: struk/invoice/faktur sekali, item per kelompok 100 id, retur & refund per kelompok bersamaan. Data fiktif.
const state = vi.hoisted(() => ({ klien: null as unknown }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.klien }));

import { ambilTenagaPenjual } from "./data";

const JUMLAH = 230;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const struk = Array.from({ length: JUMLAH }, (_, i) => ({
  id: id(i + 1), branch_id: "cab-a", no_struk: `POS-${i + 1}`, created_at: "2026-11-10T03:00:00Z", total: 20000, merchant_fee_total: 0,
  salesperson_id: "pj", cashier_id: null, payment_plan: null, payments_finalized_at: null, voided_at: null,
  branches: { name: "Cabang A" }, customers: { name: "Pelanggan" },
}));
const itemStruk = struk.map((s, i) => ({
  id: id(1000 + i), sale_id: s.id, nama: "Pakan", qty: 2, harga: 10000, item_id: null, satuan: null, faktor: 1,
  item_discount_type: null, item_discount_value: 0, promo_discount: 0, service_performers: null,
}));
const invoice = Array.from({ length: 130 }, (_, i) => ({
  id: id(3000 + i), visit_id: id(4000 + i), invoice_no: `INV-${i + 1}`, created_at: "2026-11-10T03:00:00Z", total: 100000, salesperson_id: null, voided_at: null,
  visits: { branch_id: "cab-a", doctor_id: "dokter", branches: { name: "Cabang A" }, customers: { name: "Pemilik" }, pets: { name: "Milo" } },
}));
const itemInvoice = invoice.map((v, i) => ({
  id: id(6000 + i), invoice_id: v.id, deskripsi: "Konsultasi", qty: 1, harga: 100000, jenis: "jasa", diskon_persen: 0, item_id: null,
  compound_recipe_id: null, service_performers: null, salesperson_id: null,
}));

let tiruan: ReturnType<typeof bikinKlienTiruan>;
beforeEach(() => {
  tiruan = bikinKlienTiruan({
    sales: struk, sale_items: itemStruk, invoices: invoice, invoice_items: itemInvoice,
    employees: [{ id: "pj", nama: "Penjual Fiktif", jabatan: "Kasir", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } },
      { id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } }],
    branches: [{ id: "cab-a", name: "Cabang A" }],
  });
  state.klien = tiruan.client;
});

it("hasil lengkap dan jumlah query dibatasi (item per 100 id, retur/refund per kelompok, tanpa gabungan !inner)", async () => {
  const { rows, pesanError } = await ambilTenagaPenjual({ dari: "2026-11-01", sampai: "2026-11-30" });
  expect(pesanError).toBe("");
  expect(rows.filter(r => r.kanal === "Petshop")).toHaveLength(JUMLAH);
  expect(rows.filter(r => r.kanal === "Klinik")).toHaveLength(130);
  expect(rows.filter(r => r.kanal === "Petshop").reduce((a, r) => a + r.netto, 0)).toBe(JUMLAH * 20000);
  expect(rows.filter(r => r.kanal === "Klinik").reduce((a, r) => a + r.netto, 0)).toBe(130 * 100000);
  const q = (t: string) => tiruan.catatan.filter(c => c.table === t);
  expect(q("sales")).toHaveLength(1);
  expect(q("sale_items")).toHaveLength(Math.ceil(JUMLAH / 100));
  expect(q("invoices")).toHaveLength(1);
  expect(q("invoice_items")).toHaveLength(Math.ceil(130 / 100));
  expect(q("sales_returns").length).toBeLessThanOrEqual(2);   // jumlah retur dihitung dulu; retur kecil -> dibaca sekali, bukan per 100 struk
  expect(q("clinic_refunds")).toHaveLength(Math.ceil(130 / 100));
  expect(tiruan.catatan.some(c => c.select.includes("!inner"))).toBe(false);
  // Tanpa baris obat tanpa tautan, rekam medis/resep tidak dibaca sama sekali.
  expect(q("medical_records")).toHaveLength(0);
  expect(q("compounding_recipes")).toHaveLength(0);
  expect(tiruan.catatan.length).toBeLessThanOrEqual(30);
});

it("kunjungan dengan baris obat tanpa tautan tetap dicocokkan dengan resep racikannya (hanya kunjungan itu dibaca)", async () => {
  const visitKhusus = id(4000);
  const tables = {
    sales: [], sale_items: [], invoices: invoice, invoice_items: [...itemInvoice,
      { id: id(7000), invoice_id: invoice[0].id, deskripsi: "Puyer Batuk", qty: 1, harga: 25000, jenis: "obat", diskon_persen: 0, item_id: null, compound_recipe_id: null, service_performers: null, salesperson_id: null },
      { id: id(7001), invoice_id: invoice[1].id, deskripsi: "Obat Ketikan", qty: 1, harga: 5000, jenis: "obat", diskon_persen: 0, item_id: null, compound_recipe_id: null, service_performers: null, salesperson_id: null }],
    medical_records: [{ id: "mr-1", visit_id: visitKhusus }],
    compounding_recipes: [{ id: "rc-1", medical_record_id: "mr-1", recipe_name: "puyer  batuk" }],
    employees: [{ id: "dokter", nama: "Drh. Fiktif", jabatan: "Dokter", status: "Aktif", profile_id: null, branches: { name: "Cabang A" } }],
    branches: [{ id: "cab-a", name: "Cabang A" }],
  };
  const t = bikinKlienTiruan(tables);
  state.klien = t.client;
  const { rows } = await ambilTenagaPenjual({ dari: "2026-11-01", sampai: "2026-11-30" });
  expect(rows.find(r => r.item === "Puyer Batuk")?.jenis).toBe("Racikan");
  expect(rows.find(r => r.item === "Obat Ketikan")?.jenis).toBe("Obat");
  expect(t.catatan.filter(c => c.table === "medical_records")).toHaveLength(1);
});
