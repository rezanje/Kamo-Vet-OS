import { describe, expect, it } from "vitest";
import { alasanTidakBisaUbah, jalurOwnerBelumDibayar, promoSebanding, strukBerpromo, susunUbahStruk, type BarangKatalog, type BarisLama, type StrukLama } from "@/lib/ubah-struk";
import { alasanUbahTransaksiTerhalang } from "@/lib/ubah-transaksi-petshop";

// Jalur Owner (migrasi 20261119100000): struk petshop berpromo/voucher yang penerimaannya sedang dibatalkan boleh diubah isinya oleh Owner.
// Rumus promo HARUS sama dengan database: baris tidak berubah = promo lama; baris berubah = promo lama x nilai baru / nilai lama, 2 desimal,
// dibatasi nilai baris baru.
const GOOD = "a0000000-0000-4000-8000-000000000001", SVC = "a0000000-0000-4000-8000-000000000002";
const katalog = new Map<string, BarangKatalog>([
  [GOOD, { id: GOOD, nama: "Pakan", item_type: "Persediaan", is_active: true, units: [{ unit: "pcs", factor: 1 }, { unit: "box", factor: 12 }] }],
  [SVC, { id: SVC, nama: "Grooming", item_type: "Jasa", is_active: true, units: [{ unit: "pcs", factor: 1 }] }],
]);
const baris = (over: Partial<BarisLama>): BarisLama => ({
  id: "l1", item_id: GOOD, nama: "Pakan", qty: 2, harga: 50000, satuan: "pcs", faktor: 1, target_species: "Universal", service_performers: null,
  item_discount_type: null, item_discount_value: 0, promo_id: "p1", promo_discount: 10000, quantity_pool_claim: false, promo_claim_id: null,
  promo_sets: 0, promo_syarat_units: 0, promo_hasil_units: 0, promo_floor_waiver: false, source_position: 0, components: [], ...over,
});
const lama = (items: BarisLama[], over: Partial<StrukLama> = {}): StrukLama => ({ customer_id: null, poin_digunakan: 0, subtotal: 100000, discount: 17000, diskon_kategori: 0, items, ...over });

describe("promoSebanding (sama dengan database)", () => {
  const asal = baris({});
  it("baris tidak berubah membawa promo lama persis", () => {
    expect(promoSebanding(asal, { qty: 2, harga: 50000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(10000);
  });
  it("qty naik/turun dan harga berubah: sebanding nilai baris, 2 desimal", () => {
    expect(promoSebanding(asal, { qty: 3, harga: 50000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(15000);
    expect(promoSebanding(asal, { qty: 2, harga: 45000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(9000);
    expect(promoSebanding(baris({ qty: 3, promo_discount: 10000 }), { qty: 1, harga: 50000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(3333.33);
  });
  it("dibatasi nilai baris baru; nilai lama nol = tanpa promo", () => {
    expect(promoSebanding(baris({ promo_discount: 200000 }), { qty: 1, harga: 1000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(1000);
    expect(promoSebanding(baris({ harga: 0 }), { qty: 2, harga: 50000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(0);
  });
  it("tanpa promo lama: nol", () => {
    expect(promoSebanding(baris({ promo_id: null, promo_discount: 0 }), { qty: 5, harga: 50000, satuan: "pcs", faktor: 1, item_discount_type: null, item_discount_value: 0 })).toBe(0);
  });
});

describe("susunUbahStruk jalur Owner belum dibayar", () => {
  const isian = (promo_diskon: number, tunai = 48000) => ({
    lines: [{ asal: "l1", item_id: GOOD, qty: 3, harga: 50000, satuan: "pcs", promo_diskon }, { item_id: SVC, qty: 1, harga: 20000, satuan: "pcs" }],
    diskon_kategori: 0, potongan_lain: 7000, payments: [{ method: "Tunai", amount: tunai }, { method: "Transfer", amount: 100000 }],
  });
  it("promo dihitung dari baris asal (isian klien diabaikan) dan baris membawa source_line_id", () => {
    const out = susunUbahStruk({ lama: lama([baris({})]), katalog, rupiahPerPoin: null, isian: isian(99999), jalurOwnerBelumDibayar: true });
    expect(out.header).toMatchObject({ subtotal: 170000, discount: 22000, total: 148000 });
    expect(out.lines[0]).toMatchObject({ source_line_id: "l1", promo_id: "p1", promo_discount: 15000 });
    expect(out.lines[1]).toMatchObject({ source_line_id: null, promo_id: null, promo_discount: 0 });
  });
  it("jalur lama: isi kiriman persis seperti sebelumnya (tanpa source_line_id, promo dari isian)", () => {
    const out = susunUbahStruk({ lama: lama([baris({})]), katalog, rupiahPerPoin: null, isian: isian(5000, 58000) });
    expect(out.lines[0]).not.toHaveProperty("source_line_id");
    expect(out.lines[1]).not.toHaveProperty("source_line_id");
    expect(out.lines[0]).toMatchObject({ promo_discount: 5000 });
  });
});

describe("gerbang jalur Owner", () => {
  const items = [{ promo_id: "p1", promo_claim_id: null, quantity_pool_claim: false, promo_discount: 10000 }];
  it("strukBerpromo: promo baris, klaim, kolam kuantitas, potongan promo, voucher, kode kampanye", () => {
    expect(strukBerpromo({ voucher_code: null, campaign_code: null, items: [] })).toBe(false);
    expect(strukBerpromo({ voucher_code: " ", campaign_code: null, items: [{ promo_id: null, promo_claim_id: null, quantity_pool_claim: false, promo_discount: 0 }] })).toBe(false);
    expect(strukBerpromo({ voucher_code: "V", campaign_code: null, items: [] })).toBe(true);
    expect(strukBerpromo({ voucher_code: null, campaign_code: "GROOM11", items: [] })).toBe(true);
    expect(strukBerpromo({ voucher_code: null, campaign_code: null, items })).toBe(true);
    expect(strukBerpromo({ voucher_code: null, campaign_code: null, items: [{ promo_id: null, promo_claim_id: "c", quantity_pool_claim: false, promo_discount: 0 }] })).toBe(true);
    expect(strukBerpromo({ voucher_code: null, campaign_code: null, items: [{ promo_id: null, promo_claim_id: null, quantity_pool_claim: true, promo_discount: 0 }] })).toBe(true);
  });
  it("hanya Owner aktif, pembatalan terbuka, tanpa pembatalan tertutup, struk berpromo", () => {
    const base = { isOwner: true, cancellations: [{ closed_at: null }], voucher_code: null, campaign_code: null, items };
    expect(jalurOwnerBelumDibayar(base)).toBe(true);
    expect(jalurOwnerBelumDibayar({ ...base, isOwner: false })).toBe(false);
    expect(jalurOwnerBelumDibayar({ ...base, cancellations: [] })).toBe(false);
    expect(jalurOwnerBelumDibayar({ ...base, cancellations: [{ closed_at: "2026-11-14T00:00:00Z" }] })).toBe(false);
    expect(jalurOwnerBelumDibayar({ ...base, cancellations: [{ closed_at: "2026-11-14T00:00:00Z" }, { closed_at: null }] })).toBe(false);
    expect(jalurOwnerBelumDibayar({ ...base, items: [] })).toBe(false);
  });
  it("alasanTidakBisaUbah: siklus penerimaan menolak kecuali jalur Owner", () => {
    const s = { channel: null, voided_at: null, payments_finalized_at: "2026-11-10T00:00:00Z", shift_id: "sh" };
    expect(alasanTidakBisaUbah(s, { receiptCycle: true, returns: false })).toMatch(/pernah dibatalkan penerimaannya/);
    expect(alasanTidakBisaUbah(s, { receiptCycle: true, returns: false, jalurOwnerBelumDibayar: true })).toBeNull();
    expect(alasanTidakBisaUbah(s, { receiptCycle: true, returns: true, jalurOwnerBelumDibayar: true })).toMatch(/retur/);
  });
  it("peringatan sebelum batalkan penerimaan: untuk Owner promo/voucher tidak lagi menghalangi, penggajian tetap", () => {
    expect(alasanUbahTransaksiTerhalang({ voucherCode: "V", promoItemCount: 2, payrollMonthExists: false, ownerJalurPromo: true })).toEqual([]);
    expect(alasanUbahTransaksiTerhalang({ voucherCode: "V", promoItemCount: 2, payrollMonthExists: true, ownerJalurPromo: true })).toEqual(["penggajian bulan struk ini sudah dibuat"]);
    expect(alasanUbahTransaksiTerhalang({ voucherCode: "V", promoItemCount: 0, payrollMonthExists: false })).toEqual(["struk ini memakai voucher"]);
  });
});
