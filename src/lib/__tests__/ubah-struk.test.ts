import { describe, expect, it } from "vitest";
import { alasanTidakBisaUbah, potonganLainLama, susunUbahStruk, type BarangKatalog, type BarisLama, type StrukLama } from "@/lib/ubah-struk";

const GOOD = "a0000000-0000-4000-8000-000000000001", SVC = "a0000000-0000-4000-8000-000000000002", PAKET = "a0000000-0000-4000-8000-000000000003";
const katalog = new Map<string, BarangKatalog>([
  [GOOD, { id: GOOD, nama: "Pakan", item_type: "Persediaan", is_active: true, units: [{ unit: "pcs", factor: 1 }, { unit: "box", factor: 12 }] }],
  [SVC, { id: SVC, nama: "Grooming", item_type: "Jasa", is_active: true, units: [{ unit: "pcs", factor: 1 }] }],
  [PAKET, { id: PAKET, nama: "Paket", item_type: "Grup", is_active: true, units: [{ unit: "paket", factor: 1 }] }],
]);
const baris = (over: Partial<BarisLama>): BarisLama => ({
  id: "l1", item_id: GOOD, nama: "Pakan", qty: 2, harga: 50000, satuan: "pcs", faktor: 1, target_species: "Universal", service_performers: null,
  item_discount_type: null, item_discount_value: 0, promo_id: null, promo_discount: 0, quantity_pool_claim: false, promo_claim_id: null,
  promo_sets: 0, promo_syarat_units: 0, promo_hasil_units: 0, promo_floor_waiver: false, source_position: 0, components: [], ...over,
});
const lama = (items: BarisLama[], over: Partial<StrukLama> = {}): StrukLama => ({ customer_id: null, poin_digunakan: 0, subtotal: 100000, discount: 0, diskon_kategori: 0, items, ...over });

describe("susunUbahStruk", () => {
  it("rebuilds totals, carries the old line's promo and moves to a split payment", () => {
    const old = lama([baris({ promo_id: "p1", promo_discount: 5000 })], { discount: 5000 });
    const out = susunUbahStruk({ lama: old, katalog, rupiahPerPoin: null, isian: {
      lines: [{ asal: "l1", item_id: GOOD, qty: 3, harga: 50000, satuan: "pcs", promo_diskon: 5000 }, { item_id: SVC, qty: 1, harga: 20000, satuan: "pcs" }],
      diskon_kategori: 0, potongan_lain: 10000, payments: [{ method: "Tunai", amount: 55000 }, { method: "Transfer", amount: 100000 }] } });
    expect(out.header).toMatchObject({ subtotal: 170000, total: 155000, discount: 15000, metode_bayar: "Split", bayar: 155000, kembali: 0, merchant_fee_total: 0 });
    expect(out.header.payment_plan).toEqual([{ method: "Tunai", amount: 55000 }, { method: "Transfer", amount: 100000 }]);
    expect(out.lines[0]).toMatchObject({ promo_id: "p1", promo_discount: 5000, qty: 3, faktor: 1 });
    expect(out.lines[1]).toMatchObject({ item_id: SVC, promo_id: null, promo_discount: 0 });
  });
  it("carries the Owner below-cost reason of the old line (same item) to the replacement line; a new line gets none", () => {
    const old = lama([baris({ below_hpp_owner_reason: "Mau kadaluarsa" })]);
    const out = susunUbahStruk({ lama: old, katalog, rupiahPerPoin: null, isian: {
      lines: [{ asal: "l1", item_id: GOOD, qty: 2, harga: 50000, satuan: "pcs" }, { item_id: GOOD, qty: 1, harga: 50000, satuan: "pcs" }],
      diskon_kategori: 0, potongan_lain: 0, payments: [{ method: "Tunai", amount: 150000 }] } });
    expect(out.lines[0]).toMatchObject({ below_hpp_owner_reason: "Mau kadaluarsa" });
    expect(out.lines[1]).toMatchObject({ below_hpp_owner_reason: null });
    const plain = susunUbahStruk({ lama: lama([baris({})]), katalog, rupiahPerPoin: null, isian: {
      lines: [{ asal: "l1", item_id: GOOD, qty: 2, harga: 50000, satuan: "pcs" }], diskon_kategori: 0, potongan_lain: 0, payments: [{ method: "Tunai", amount: 100000 }] } });
    expect(plain.lines[0]).toMatchObject({ below_hpp_owner_reason: null });
  });
  it("adds the merchant fee on top like the cashier and earns points from the goods total", () => {
    const out = susunUbahStruk({ lama: lama([baris({})], { customer_id: "c1" }), katalog, rupiahPerPoin: 1000, isian: {
      lines: [{ asal: "l1", item_id: GOOD, qty: 2, harga: 50000, satuan: "pcs" }], diskon_kategori: 0, potongan_lain: 0,
      payments: [{ method: "QRIS", amount: 100000, fee_percent: 1 }] } });
    expect(out.header).toMatchObject({ total: 101000, merchant_fee_total: 1000, metode_bayar: "QRIS", poin_earned: 100 });
    expect(out.header.payment_plan).toEqual([{ method: "QRIS", amount: 101000, fee_percent: 1, fee_amount: 1000 }]);
  });
  it("uses the master unit factor and scales package components", () => {
    const paket = baris({ id: "g1", item_id: PAKET, nama: "Paket", satuan: "paket", qty: 1, harga: 30000,
      components: [{ component_item_id: GOOD, component_code: "P", component_name: "Pakan", item_type: "Persediaan", qty_per_group: 2, unit: "pcs", factor: 1, total_base_qty: 2, sort_order: 0 }] });
    const out = susunUbahStruk({ lama: lama([paket]), katalog, rupiahPerPoin: null, isian: {
      lines: [{ asal: "g1", item_id: PAKET, qty: 3, harga: 30000, satuan: "paket" }, { item_id: GOOD, qty: 1, harga: 500000, satuan: "box" }],
      diskon_kategori: 0, potongan_lain: 0, payments: [{ method: "Tunai", amount: 590000 }] } });
    expect((out.lines[0].components as { total_base_qty: number }[])[0].total_base_qty).toBe(6);
    expect(out.lines[1]).toMatchObject({ satuan: "box", faktor: 12 });
  });
  it.each([
    ["payment differs from total", { payments: [{ method: "Tunai", amount: 90000 }] }, /harus sama dengan total/],
    ["unknown unit", { lines: [{ asal: "l1", item_id: GOOD, qty: 2, harga: 50000, satuan: "karung" }] }, /Satuan karung/],
    ["swapping an old line's item", { lines: [{ asal: "l1", item_id: SVC, qty: 1, harga: 100000, satuan: "pcs" }] }, /tidak boleh diganti/],
    ["adding a package", { lines: [{ item_id: PAKET, qty: 1, harga: 100000, satuan: "paket" }] }, /tidak bisa ditambahkan/],
    ["line from another receipt", { lines: [{ asal: "zz", item_id: GOOD, qty: 2, harga: 50000, satuan: "pcs" }] }, /bukan milik struk ini/],
    ["discount above goods", { potongan_lain: 200000 }, /melebihi/],
    ["duplicate method", { payments: [{ method: "Tunai", amount: 50000 }, { method: "Tunai", amount: 50000 }] }, /dobel/],
    ["no lines", { lines: [] }, /minimal satu barang/],
  ])("rejects %s", (_label, patch, message) => {
    const isian = { lines: [{ asal: "l1", item_id: GOOD, qty: 2, harga: 50000, satuan: "pcs" }], diskon_kategori: 0, potongan_lain: 0,
      payments: [{ method: "Tunai", amount: 100000 }], ...patch };
    expect(() => susunUbahStruk({ lama: lama([baris({})]), katalog, rupiahPerPoin: null, isian })).toThrow(message as RegExp);
  });
});

describe("helpers", () => {
  it("separates line discounts from other header discounts", () => {
    expect(potonganLainLama(lama([baris({ item_discount_type: "nominal", item_discount_value: 4000 })], { discount: 10000 }))).toBe(6000);
  });
  it("explains why a receipt cannot be edited", () => {
    const ok = { channel: null, voided_at: null, payments_finalized_at: "x", shift_id: "s" };
    expect(alasanTidakBisaUbah(ok, { receiptCycle: false, returns: false })).toBeNull();
    expect(alasanTidakBisaUbah({ ...ok, voided_at: "x" }, { receiptCycle: false, returns: false })).toMatch(/sudah diubah/);
    expect(alasanTidakBisaUbah(ok, { receiptCycle: false, returns: true })).toMatch(/retur/);
    expect(alasanTidakBisaUbah({ ...ok, channel: "shopee" }, { receiptCycle: false, returns: false })).toMatch(/kasir petshop/);
  });
});
