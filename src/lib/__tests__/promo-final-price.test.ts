import { describe, expect, it } from "vitest";
import { convertFinalPrice, parseFinalPrice, type FinalPriceInput } from "../promo-final-price";
import { validatePromoRows, type PromoPricing } from "../promo-bulk";

const A = { id: "branch-a", name: "Cabang A" };
const B = { id: "branch-b", name: "Cabang B" };
const base = (over: Partial<FinalPriceInput> = {}): FinalPriceInput => ({
  raw: "18500", unit: "PCS",
  item: { id: "item-1", unit: "PCS", item_type: "Persediaan", sell_price: 20000, buy_price: 12000 },
  unitRow: null, scope: [A, B], branchPrices: [], hasQuantityTiers: false, ...over,
});
const fail = (input: FinalPriceInput) => {
  const result = convertFinalPrice(input);
  if (result.ok) throw new Error("expected rejection, got " + JSON.stringify(result));
  return result;
};

describe("parseFinalPrice", () => {
  it("accepts plain whole rupiah and dot decimals up to two digits", () => {
    expect(parseFinalPrice("18500")).toEqual({ cents: 1850000 });
    expect(parseFinalPrice("18500.5")).toEqual({ cents: 1850050 });
    expect(parseFinalPrice("18500.25")).toEqual({ cents: 1850025 });
  });
  it.each(["18.500", "18,500", "Rp 18.500", "Rp18500", "1.500.000", "18500,5", "1,500.00", "18 500"])(
    "rejects ambiguous or formatted amount %j instead of guessing", raw => {
      const result = parseFinalPrice(raw);
      expect(result).toEqual({ error: expect.stringContaining("angka polos") });
    });
  it.each(["", "abc", "-100", "0", "0.00", "1e3", "18500.123"])("rejects non-positive or malformed %j", raw => {
    expect("error" in parseFinalPrice(raw)).toBe(true);
  });
});

describe("convertFinalPrice", () => {
  it("converts to a per-unit nominal discount, with potongan and percent off", () => {
    expect(convertFinalPrice(base())).toEqual({ ok: true, normalPrice: 20000, finalPrice: 18500, potongan: 1500, percentOff: 7.5 });
  });
  it("rounds percent off to two decimals", () => {
    const result = convertFinalPrice(base({ raw: "19999", item: { ...base().item, sell_price: 20000 } }));
    expect(result).toMatchObject({ ok: true, potongan: 1, percentOff: 0.01 });
  });
  it("rejects a final price equal to the normal price as 'tidak ada potongan'", () => {
    expect(fail(base({ raw: "20000" })).error).toMatch(/tidak ada potongan/);
  });
  it("rejects a final price above the normal price", () => {
    const result = fail(base({ raw: "21000" }));
    expect(result.error).toMatch(/lebih tinggi/);
    expect(result.normalPrice).toBe(20000);
  });
  it("requires the nominal discount per unit to be whole rupiah (the register rounds the line discount to whole rupiah)", () => {
    // whole normal price, fractional final -> fractional discount
    const whole = fail(base({ raw: "18500.5" }));
    expect(whole.error).toMatch(/selisih harus rupiah bulat/);
    expect(whole.error).toMatch(/Rp\s?20\.000/);
    expect(whole.error).toMatch(/Rp\s?18\.500,5/);
    // fractional normal price: 10.50 -> 10 is a 0.50 discount, 10.33 a 0.17 discount: both rejected
    const frac = (raw: string) => fail(base({ raw, item: { ...base().item, sell_price: "10.50", buy_price: "0.01" } }));
    expect(frac("10").error).toMatch(/selisih harus rupiah bulat/);
    expect(frac("10").error).toMatch(/Rp\s?10,5/);
    expect(frac("10.33").error).toMatch(/selisih harus rupiah bulat/);
    expect(frac("10").normalPrice).toBe(10.5);
    // fractional normal price with a whole-rupiah difference stays valid
    const ok = convertFinalPrice(base({ raw: "9.50", item: { ...base().item, sell_price: "10.50", buy_price: "0.01" } }));
    expect(ok).toMatchObject({ ok: true, normalPrice: 10.5, finalPrice: 9.5, potongan: 1 });
    const ok2 = convertFinalPrice(base({ raw: "18500.25", item: { ...base().item, sell_price: 20000.25 } }));
    expect(ok2).toMatchObject({ ok: true, potongan: 1500, normalPrice: 20000.25 });
  });
  it("uses the registered derived unit's own price, not the base price", () => {
    const result = convertFinalPrice(base({ unit: "DUS", raw: "200000", unitRow: { sell_price: 240000, buy_price: 150000 } }));
    expect(result).toMatchObject({ ok: true, normalPrice: 240000, potongan: 40000 });
  });
  it("rejects when the unit has no determinable or no positive normal price", () => {
    expect(fail(base({ unit: "DUS", unitRow: { sell_price: null, buy_price: 1 } })).error).toMatch(/harga normal/i);
    expect(fail(base({ unit: "DUS", unitRow: null })).error).toMatch(/harga normal/i);
    expect(fail(base({ item: { ...base().item, sell_price: 0 } })).error).toMatch(/harga normal.*belum/i);
  });
  it("requires a branch scope", () => {
    expect(fail(base({ scope: null })).error).toMatch(/Pilih cabang/);
    expect(fail(base({ scope: [] })).error).toMatch(/Pilih cabang/);
  });
  it("rejects with both prices named when the unit's normal price differs across the batch branches", () => {
    const result = fail(base({ branchPrices: [{ item_id: "item-1", branch_id: "branch-b", unit: "PCS", sell_price: 21000 }] }));
    expect(result.error).toMatch(/berbeda antar cabang/);
    expect(result.error).toContain("Cabang A");
    expect(result.error).toContain("Cabang B");
    expect(result.error).toMatch(/Rp\s?20\.000/);
    expect(result.error).toMatch(/Rp\s?21\.000/);
  });
  it("uses the single branch's own override when the batch targets only that branch", () => {
    const prices = [{ item_id: "item-1", branch_id: "branch-b", unit: "PCS", sell_price: 21000 }];
    expect(convertFinalPrice(base({ scope: [B], branchPrices: prices }))).toMatchObject({ ok: true, normalPrice: 21000, potongan: 2500 });
    expect(convertFinalPrice(base({ scope: [A], branchPrices: prices }))).toMatchObject({ ok: true, normalPrice: 20000 });
  });
  it("accepts an override identical to the central price and ignores other units/items", () => {
    const prices = [
      { item_id: "item-1", branch_id: "branch-b", unit: "PCS", sell_price: 20000 },
      { item_id: "item-1", branch_id: "branch-b", unit: "DUS", sell_price: 1 },
      { item_id: "other", branch_id: "branch-a", unit: "PCS", sell_price: 1 },
    ];
    expect(convertFinalPrice(base({ branchPrices: prices }))).toMatchObject({ ok: true, normalPrice: 20000 });
  });
  it("rejects items with quantity price tiers because the cashier price is not the normal price", () => {
    expect(fail(base({ hasQuantityTiers: true })).error).toMatch(/bertingkat/);
  });
  describe("HPP floor (mirrors the cashier price floor: below cost rejected, unknown cost never allowed)", () => {
    it("rejects below master buy price, allows exactly at it", () => {
      expect(fail(base({ raw: "11999" })).error).toMatch(/di bawah.*HPP/i);
      expect(convertFinalPrice(base({ raw: "12000" }))).toMatchObject({ ok: true });
    });
    it("rejects when cost is unknown instead of silently allowing", () => {
      expect(fail(base({ item: { ...base().item, buy_price: 0 } })).error).toMatch(/HPP.*belum.*(terisi|dapat)/i);
      expect(fail(base({ item: { ...base().item, buy_price: null } })).error).toMatch(/HPP/i);
    });
    it("uses the derived unit's buy price", () => {
      expect(fail(base({ unit: "DUS", raw: "149999", unitRow: { sell_price: 240000, buy_price: 150000 } })).error).toMatch(/di bawah.*HPP/i);
    });
    it("does not apply to services, but refuses packages (cost cannot be determined here)", () => {
      expect(convertFinalPrice(base({ raw: "100", item: { ...base().item, item_type: "Jasa", buy_price: 0 } }))).toMatchObject({ ok: true });
      expect(fail(base({ item: { ...base().item, item_type: "Grup" } })).error).toMatch(/paket/i);
      expect(fail(base({ item: { ...base().item, item_type: null } })).error).toMatch(/jenis barang tidak terbaca/i);
    });
    it("Non-Persediaan has no cashier price floor (isPriceFloorGoods = Persediaan/Grup only): no buy price needed", () => {
      const nonStock = { ...base().item, item_type: "Non-Persediaan", buy_price: 0 };
      expect(convertFinalPrice(base({ raw: "100", item: nonStock }))).toMatchObject({ ok: true, potongan: 19900 });
      expect(convertFinalPrice(base({ raw: "100", item: { ...nonStock, buy_price: null } }))).toMatchObject({ ok: true });
      // a Persediaan item with the same missing cost is still rejected
      expect(fail(base({ raw: "100", item: { ...nonStock, item_type: "Persediaan" } })).error).toMatch(/HPP/);
    });
    it("an unknown item type message does not blame Non-Persediaan", () => {
      expect(fail(base({ item: { ...base().item, item_type: "Aneh" } })).error).toMatch(/Jenis barang "Aneh" tidak dikenal/);
    });
  });
});

const items = [
  { id: "i1", code: "FIKTIF-1", name: "Barang Fiktif Satu", unit: "1/2KG", is_active: true, item_type: "Persediaan", sell_price: 20000, buy_price: 10000 },
  { id: "i2", code: "FIKTIF-2", name: "Barang Fiktif Dua", unit: "400gr", is_active: true, item_type: "Persediaan", sell_price: 30000, buy_price: 15000 },
  { id: "i3", code: "FIKTIF-OFF", name: "Nonaktif", unit: "KG", is_active: false, item_type: "Persediaan", sell_price: 1000, buy_price: 1 },
];
const units = [{ item_id: "i1", unit: "KG", sell_price: 38000, buy_price: 19000 }];
const pricing = (over: Partial<PromoPricing> = {}): PromoPricing => ({ scope: [A, B], branchPrices: [], tierItemIds: [], ...over });
const r = (line: number, code: string, unit: string, kind: string, value: string) =>
  ({ line, code, unit, discount_type: kind, discount_value: value });

describe("validatePromoRows with Harga Akhir", () => {
  it("handles Persen + Nominal + Harga Akhir in one file and sends only nominal/percent to the engine", () => {
    const result = validatePromoRows([
      r(2, "FIKTIF-1", "1/2KG", "Persen", "10"),
      r(3, "FIKTIF-1", "KG", "Harga Akhir", "36000"),
      r(4, "FIKTIF-2", "400gr", "Harga Akhir Promo", "27000"),
      r(5, "FIKTIF-2", "400GR", "Nominal", "500"),
    ], items, units, pricing());
    expect(result.reviewed.map(row => row.error)).toEqual([null, null, null, expect.stringContaining("Satuan tidak terdaftar")]);
    expect(result.valid).toEqual([
      { code: "FIKTIF-1", unit: "1/2KG", discount_type: "percent", discount_value: 10 },
      { code: "FIKTIF-1", unit: "KG", discount_type: "nominal", discount_value: 2000 },
      { code: "FIKTIF-2", unit: "400gr", discount_type: "nominal", discount_value: 3000 },
    ]);
    expect(result.reviewed[1]).toMatchObject({ discount_type: "final_price", discount_value: "36000", item_name: "Barang Fiktif Satu",
      normal_price: 38000, final_price: 36000, potongan: 2000, percent_off: 5.26, matched_unit: "KG" });
    expect(result.reviewed[0]).toMatchObject({ normal_price: null, final_price: null, potongan: null, percent_off: null });
  });
  it("matches 'harga akhir' case-insensitively and with extra spaces", () => {
    const rows = ["harga akhir", "HARGA AKHIR PROMO", "  Harga   Akhir "].map((kind, index) => r(index + 2, "FIKTIF-2", "400gr", kind, "27000"));
    const result = validatePromoRows(rows.slice(0, 1), items, units, pricing());
    expect(result.valid).toHaveLength(1);
    for (const row of rows.slice(1)) expect(validatePromoRows([row], items, units, pricing()).valid).toHaveLength(1);
  });
  it("rejects a duplicate SKU+unit even when kinds differ", () => {
    const result = validatePromoRows([r(2, "FIKTIF-2", "400gr", "Persen", "10"), r(3, "FIKTIF-2", "400gr", "Harga Akhir", "27000")], items, units, pricing());
    expect(result.reviewed[1].error).toMatch(/duplikat/);
    expect(result.valid).toHaveLength(1);
  });
  it("rejects inactive SKU and unregistered units, and never repairs 400g4", () => {
    const result = validatePromoRows([
      r(2, "FIKTIF-OFF", "KG", "Harga Akhir", "500"),
      r(3, "FIKTIF-2", "400g4", "Harga Akhir", "27000"),
      r(4, "FIKTIF-2", "800GR", "Harga Akhir", "27000"),
    ], items, units, pricing());
    expect(result.reviewed[0].error).toMatch(/nonaktif/);
    expect(result.reviewed[1].error).toMatch(/Satuan tidak terdaftar/);
    expect(result.reviewed[1].matched_unit).toBeNull();
    expect(result.reviewed[2].error).toMatch(/Satuan tidak terdaftar/);
    expect(result.valid).toEqual([]);
  });
  it("keeps unit matching exact: 1/2kg is rejected and the registered spelling is shown", () => {
    const result = validatePromoRows([r(2, "FIKTIF-1", "1/2kg", "Harga Akhir", "18000"), r(3, "FIKTIF-1", "1/2KG", "Harga Akhir", "18000")], items, units, pricing());
    expect(result.reviewed[0].error).toMatch(/Satuan tidak terdaftar.*1\/2KG.*persis/);
    expect(result.reviewed[1]).toMatchObject({ error: null, matched_unit: "1/2KG" });
  });
  it("fails closed when no price data was supplied", () => {
    const result = validatePromoRows([r(2, "FIKTIF-2", "400gr", "Harga Akhir", "27000")], items, units);
    expect(result.reviewed[0].error).toMatch(/harga normal/i);
    expect(result.valid).toEqual([]);
  });
  it("applies price tiers, branch differences and ambiguity per row", () => {
    const result = validatePromoRows([
      r(2, "FIKTIF-1", "1/2KG", "Harga Akhir", "18.500"),
      r(3, "FIKTIF-2", "400gr", "Harga Akhir", "27000"),
      r(4, "FIKTIF-1", "1/2KG", "Harga Akhir", "18000"),
    ], items, units, pricing({ tierItemIds: ["i2"], branchPrices: [{ item_id: "i1", branch_id: "branch-b", unit: "1/2KG", sell_price: 21000 }] }));
    expect(result.reviewed[0].error).toMatch(/angka polos/);
    expect(result.reviewed[1].error).toMatch(/bertingkat/);
    expect(result.reviewed[2].error).toMatch(/duplikat/);
  });
  it("lists the supported kinds when the kind is unknown", () => {
    const result = validatePromoRows([r(2, "FIKTIF-2", "400gr", "Gratis", "1")], items, units, pricing());
    expect(result.reviewed[0].error).toBe("Jenis diskon harus Persen, Nominal, atau Harga Akhir");
  });
});
