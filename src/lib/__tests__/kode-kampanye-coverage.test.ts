import { describe, expect, it } from "vitest";
import { kunciGrupKampanye, notaMemuatKampanye, pesanBukanKampanye, type KodeKampanye } from "../kode-kampanye";
import { hitungKodeKampanyePos } from "../kode-kampanye-pos";
import { bacaDraftPos } from "../pos-draft";
import type { PromoHitung } from "../promo-hitung";
import type { VoucherRow } from "../voucher";

// C05 follow-up: parsing rules for group payment (rombongan) and back-office POS.
const kodeVoucher: KodeKampanye = { code: "PROMO10", voucher_code: "HEMAT10", promo_id: null, is_active: true, max_uses: 2 };
const kodePromo: KodeKampanye = { code: "DISKON20", voucher_code: null, promo_id: "p-kode", is_active: true };
const voucher: VoucherRow = { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null,
  max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null };
const promo = (id: string, autoApply: boolean, itemIds = ["sku"]): PromoHitung => ({
  id, name: id, itemIds, minQty: null, maxQty: null, kelipatan: false, autoApply, discountType: "percent", discountValue: 20,
});

describe("rombongan group key", () => {
  it("is owner + WIB day, the exact key the database accepts", () => {
    expect(kunciGrupKampanye("owner-1", "2026-10-29")).toBe("owner-1:2026-10-29");
  });
  it("has no key without an owner or with a malformed day", () => {
    expect(kunciGrupKampanye(null, "2026-10-29")).toBeNull();
    expect(kunciGrupKampanye("owner-1", "29/10/2026")).toBeNull();
  });
});

describe("which group invoice carries the code", () => {
  it("voucher-bound: only invoices with a voucher share", () => {
    expect(notaMemuatKampanye(kodeVoucher, { voucher: 5000, promoKode: 0 })).toBe(true);
    expect(notaMemuatKampanye(kodeVoucher, { voucher: 0, promoKode: 9000 })).toBe(false);
  });
  it("promo-bound: only invoices the bound promo actually cut", () => {
    expect(notaMemuatKampanye(kodePromo, { voucher: 0, promoKode: 1 })).toBe(true);
    expect(notaMemuatKampanye(kodePromo, { voucher: 0, promoKode: 0 })).toBe(false);
  });
  it("no campaign code, no campaign fields", () => {
    expect(notaMemuatKampanye(null, { voucher: 5000, promoKode: 5000 })).toBe(false);
  });
});

describe("back-office POS code field", () => {
  const cart = [{ item_id: "sku", qty: 1, harga: 100000 }];
  const base = { daftar: [kodeVoucher, kodePromo], promos: [promo("p-kode", false)], cart, subtotal: 100000,
    voucher, hariIni: "2026-10-29", customerId: null, categoryId: null };

  it("empty field: only automatic promos, nothing written", () => {
    expect(hitungKodeKampanyePos({ ...base, kode: "" })).toMatchObject({ tolak: null, potonganPromo: 0, potonganVoucher: 0, voucherCode: null, campaignCode: null });
  });
  it("voucher-bound campaign code → bound voucher's formula, both codes written", () => {
    expect(hitungKodeKampanyePos({ ...base, kode: " promo 10" })).toMatchObject({ tolak: null, potonganVoucher: 10000, voucherCode: "HEMAT10", campaignCode: "PROMO10" });
  });
  it("promo-bound campaign code → its promo applies, no voucher", () => {
    const hasil = hitungKodeKampanyePos({ ...base, kode: "diskon20" });
    expect(hasil).toMatchObject({ tolak: null, potonganPromo: 20000, potonganVoucher: 0, voucherCode: null, campaignCode: "DISKON20" });
    expect(hasil.rincianPromo[0]).toMatchObject({ promoId: "p-kode", lineIndex: 0 });
  });
  it("plain voucher code is refused here (cashier screen only)", () => {
    expect(pesanBukanKampanye("HEMAT10", null)).toMatch(/bukan kode kampanye/);
    expect(hitungKodeKampanyePos({ ...base, kode: "HEMAT10" })).toMatchObject({ tolak: expect.stringMatching(/bukan kode kampanye/), potonganVoucher: 0, campaignCode: null });
  });
  it("a refused code never leaves its promo or voucher in the totals", () => {
    const off = hitungKodeKampanyePos({ ...base, daftar: [{ ...kodePromo, is_active: false }], kode: "DISKON20" });
    expect(off).toMatchObject({ tolak: expect.stringMatching(/dinonaktifkan/), potonganPromo: 0, campaignCode: null });
    const nothing = hitungKodeKampanyePos({ ...base, cart: [{ item_id: "other", qty: 1, harga: 100000 }], kode: "DISKON20" });
    expect(nothing.tolak).toMatch(/belum memberi potongan/);
  });
  it("voucher rules of the bound voucher still apply (minimum spend, unknown voucher)", () => {
    expect(hitungKodeKampanyePos({ ...base, voucher: { ...voucher, min_belanja: 200000 }, kode: "PROMO10" }).tolak).toMatch(/minimal/);
    expect(hitungKodeKampanyePos({ ...base, voucher: null, kode: "PROMO10" }).tolak).toBe("Kode voucher tidak ditemukan");
    expect(hitungKodeKampanyePos({ ...base, voucher: { ...voucher, code: "LAIN" }, kode: "PROMO10" }).tolak).toBe("Kode voucher tidak ditemukan");
  });
});

describe("back-office draft keeps the typed code (part of the checkout identity)", () => {
  const draft = { version: 1, savedAt: 1_000, branchId: "b", customerId: "", petId: "", salespersonId: "", metode: "Tunai", discount: 0, bayar: 0,
    cart: [{ item_id: "sku", nama: "x", qty: 1, harga: 1, target_species: "Universal", satuan: "pcs", faktor: 1 }] };
  it("restores the code and drops blanks / non-strings", () => {
    expect(bacaDraftPos(JSON.stringify({ ...draft, voucherCode: "PROMO10" }), 2_000)?.voucherCode).toBe("PROMO10");
    expect(bacaDraftPos(JSON.stringify({ ...draft, voucherCode: "  " }), 2_000)).not.toHaveProperty("voucherCode");
    expect(bacaDraftPos(JSON.stringify({ ...draft, voucherCode: 7 }), 2_000)).not.toHaveProperty("voucherCode");
  });
});
