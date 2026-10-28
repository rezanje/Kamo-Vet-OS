import { describe, expect, it } from "vitest";
import { bacaKode, pesanGagalKampanye, pesanKampanyeDitolak, promoDenganKode, type KodeKampanye } from "../kode-kampanye";
import { hitungPromoKeranjang, type PromoHitung } from "../promo-hitung";
import { potonganVoucher } from "../voucher";

const kodeVoucher: KodeKampanye = { code: "PROMO10", voucher_code: "HEMAT10", promo_id: null, is_active: true, max_uses: 2 };
const kodePromo: KodeKampanye = { code: "DISKON20", voucher_code: null, promo_id: "p-kode", is_active: true };
const promo = (id: string, autoApply: boolean): PromoHitung => ({
  id, name: id, itemIds: ["sku"], minQty: null, maxQty: null, kelipatan: false, autoApply,
  discountType: "percent", discountValue: 20,
});

describe("bacaKode", () => {
  it("maps a typed campaign code (any case/spacing) to its voucher", () => {
    expect(bacaKode(" promo 10 ", [kodeVoucher, kodePromo])).toEqual({
      kode: "PROMO10", kampanye: kodeVoucher, voucherCode: "HEMAT10", promoId: null,
    });
  });
  it("maps a promo-bound code to its promo and carries no voucher", () => {
    expect(bacaKode("diskon20", [kodeVoucher, kodePromo])).toMatchObject({ voucherCode: null, promoId: "p-kode" });
  });
  it("leaves ordinary voucher codes untouched", () => {
    expect(bacaKode("hemat10", [kodeVoucher])).toEqual({ kode: "HEMAT10", kampanye: null, voucherCode: "HEMAT10", promoId: null });
    expect(bacaKode("", [kodeVoucher])).toEqual({ kode: null, kampanye: null, voucherCode: null, promoId: null });
  });
});

describe("promo-bound code", () => {
  const cart = [{ item_id: "sku", qty: 1, harga: 100000 }];
  it("applies a non-automatic promo only when its code is entered", () => {
    const promos = [promo("p-kode", false)];
    expect(hitungPromoKeranjang(promos, cart)).toEqual([]);
    expect(hitungPromoKeranjang(promoDenganKode(promos, "p-kode"), cart)[0].potongan).toBe(20000);
    expect(promos[0].autoApply).toBe(false);                    // master list not mutated
  });
  it("rejects inactive codes, promos not valid here, and codes that discount nothing", () => {
    expect(pesanKampanyeDitolak({ ...kodePromo, is_active: false }, true, true)).toMatch(/dinonaktifkan/);
    expect(pesanKampanyeDitolak(kodePromo, false, false)).toMatch(/tidak berlaku di cabang/);
    expect(pesanKampanyeDitolak(kodePromo, true, false)).toMatch(/belum memberi potongan/);
    expect(pesanKampanyeDitolak(kodePromo, true, true)).toBeNull();
    expect(pesanKampanyeDitolak(kodeVoucher, false, false)).toBeNull();
  });
});

describe("voucher-bound code keeps the voucher formula", () => {
  it("same discount as typing the voucher itself", () => {
    expect(potonganVoucher(90000, { tipe: "persen", nilai: 10, max_potongan: 5000 })).toBe(5000);
  });
});

describe("pesanGagalKampanye", () => {
  it("surfaces database cap messages and ignores others", () => {
    expect(pesanGagalKampanye("KODE_KAMPANYE: Kode PROMO10 sudah mencapai batas pemakaian (2 kali)"))
      .toBe("Kode PROMO10 sudah mencapai batas pemakaian (2 kali)");
    expect(pesanGagalKampanye("duplicate key")).toBeNull();
    expect(pesanGagalKampanye(undefined)).toBeNull();
  });
});

describe("loadPromoAktif with campaign promos", () => {
  type Row = Record<string, unknown>;
  const row = (id: string, auto: boolean): Row => ({ id, name: id, rule: {}, branch_ids: null, valid_from: null, valid_until: null,
    is_active: true, auto_apply: auto, min_qty: null, max_qty: null, kelipatan: false, discount_type: "percent", discount_value: 20 });
  const db = (promos: Row[]) => ({
    from(table: string) {
      const eqs: Record<string, unknown> = {}; let ids: string[] | null = null;
      const rows = () => (table === "promos" ? promos : []).filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v)
        && (!ids || (table === "promos" ? ids.includes(String(r.id)) : true)));
      const q = {
        select: () => q, eq: (k: string, v: unknown) => { eqs[k] = v; return q; }, in: (_k: string, v: string[]) => { ids = v; return q; },
        order: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: rows().slice(a, b + 1), error: null, count: rows().length }),
        then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve),
      };
      return q;
    },
  });
  it("loads the bound non-automatic promo without auto-applying it", async () => {
    const { loadPromoAktif } = await import("../promo-hitung");
    const all = await loadPromoAktif(db([row("auto", true), row("kode", false), row("lain", false)]), "b", ["kode"]);
    expect(all.map((p) => [p.id, p.autoApply])).toEqual([["auto", true], ["kode", false]]);
    const plain = await loadPromoAktif(db([row("auto", true), row("kode", false)]), "b");
    expect(plain.map((p) => p.id)).toEqual(["auto"]);
  });
});
