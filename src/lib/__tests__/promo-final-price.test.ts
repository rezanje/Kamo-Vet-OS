import { describe, expect, it } from "vitest";
import { convertFinalPrice, parseFinalPrice, MISSING_COST_WARNING, type FinalPriceInput } from "../promo-final-price";
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
    it("warns (valid, not an error) when the master cost is missing/0, with the exact warning text", () => {
      expect(MISSING_COST_WARNING).toBe("HPP master belum terisi; harga akhir belum bisa dicek terhadap modal. Kasir petshop dan klinik menolak penjualan di bawah HPP FIFO; transaksi back office (/pos/transaksi) hanya memberi peringatan yang bisa dikonfirmasi (tanpa peringatan bila HPP FIFO tidak terbaca).");
      for (const buy_price of [0, "0.00", "0", null, undefined, ""]) {
        const result = convertFinalPrice(base({ raw: "14000", item: { ...base().item, buy_price } }));
        expect(result).toEqual({ ok: true, normalPrice: 20000, finalPrice: 14000, potongan: 6000, percentOff: 30, warning: MISSING_COST_WARNING });
      }
      // a derived unit without its own buy price warns too
      expect(convertFinalPrice(base({ unit: "DUS", raw: "200000", unitRow: { sell_price: 240000, buy_price: "0.00" } }))).toMatchObject({ ok: true, warning: MISSING_COST_WARNING });
    });
    it("gives no warning when cost is known (below -> error, equal/above -> ok without warning)", () => {
      expect("warning" in (convertFinalPrice(base({ raw: "12000" })) as object)).toBe(false);
      expect("warning" in (convertFinalPrice(base({ raw: "18500" })) as object)).toBe(false);
      expect(fail(base({ raw: "7000", item: { ...base().item, buy_price: 8000 } })).error).toMatch(/di bawah.*HPP/i);
    });
    it("other rules still run first when cost is missing: not-lower, fractional, tiers, branch price, ambiguity", () => {
      const noCost = { ...base().item, buy_price: 0 };
      expect(fail(base({ raw: "20000", item: noCost })).error).toMatch(/tidak ada potongan/);
      expect(fail(base({ raw: "21000", item: noCost })).error).toMatch(/lebih tinggi/);
      expect(fail(base({ raw: "18500.5", item: noCost })).error).toMatch(/selisih harus rupiah bulat/);
      expect(fail(base({ raw: "18500", item: noCost, hasQuantityTiers: true })).error).toMatch(/bertingkat/);
      expect(fail(base({ raw: "18.500", item: noCost })).error).toMatch(/angka polos/);
      expect(fail(base({ raw: "18500", item: noCost, branchPrices: [{ item_id: "item-1", branch_id: "branch-b", unit: "PCS", sell_price: 21000 }] })).error).toMatch(/berbeda antar cabang/);
      expect(fail(base({ raw: "18500", item: noCost, scope: null })).error).toMatch(/Pilih cabang/);
    });
    it("uses the derived unit's buy price", () => {
      expect(fail(base({ unit: "DUS", raw: "149999", unitRow: { sell_price: 240000, buy_price: 150000 } })).error).toMatch(/di bawah.*HPP/i);
    });
    it("derived unit with own buy 0 uses base buy x factor: base 5000 x 12 = 60000 -> final 1000 is an ERROR, exactly 60000 is ok without warning", () => {
      const item = { ...base().item, buy_price: 5000 };
      const unitRow = { sell_price: 240000, buy_price: 0, factor: 12 };
      const err = fail(base({ unit: "DUS", raw: "1000", item, unitRow })).error;
      expect(err).toMatch(/di bawah.*HPP/i);
      expect(err).toMatch(/60\.000/);
      expect(fail(base({ unit: "DUS", raw: "59999", item, unitRow })).error).toMatch(/di bawah.*HPP/i);
      const ok = convertFinalPrice(base({ unit: "DUS", raw: "60000", item, unitRow: { ...unitRow, buy_price: "0.00", factor: "12.0000" } }));
      expect(ok).toMatchObject({ ok: true });
      expect("warning" in (ok as object)).toBe(false);
      // missing unit buy_price (undefined/null/"") behaves like 0
      for (const buy_price of [undefined, null, ""]) expect(fail(base({ unit: "DUS", raw: "1000", item, unitRow: { sell_price: 240000, buy_price, factor: 12 } })).error).toMatch(/di bawah.*HPP/i);
    });
    it("derived unit warns only when NEITHER its own buy price NOR base buy x factor is known", () => {
      const unitRow = { sell_price: 240000, buy_price: 0, factor: 12 };
      expect(convertFinalPrice(base({ unit: "DUS", raw: "1000", item: { ...base().item, buy_price: 0 }, unitRow }))).toMatchObject({ ok: true, warning: MISSING_COST_WARNING });
      // base cost known but conversion factor missing/invalid: cost cannot be derived -> warning
      for (const factor of [undefined, null, 0, "0.0000"]) {
        expect(convertFinalPrice(base({ unit: "DUS", raw: "1000", item: { ...base().item, buy_price: 5000 }, unitRow: { ...unitRow, factor } }))).toMatchObject({ ok: true, warning: MISSING_COST_WARNING });
      }
    });
    it("derived unit: base x factor is the cost whenever base buy is known; own item_units.buy_price is IGNORED (cashier never reads it)", () => {
      const item = { ...base().item, buy_price: 5000 };
      // own 3000 < base x factor 60000: base 5000, DUS x12, final 4000 -> ERROR naming 60.000 (review v4 L1 probe)
      const low = fail(base({ unit: "DUS", raw: "4000", item, unitRow: { sell_price: 240000, buy_price: 3000, factor: 12 } }));
      expect(low.error).toMatch(/di bawah.*HPP/i);
      expect(low.error).toMatch(/60\.000/);
      expect(fail(base({ unit: "DUS", raw: "59999", item, unitRow: { sell_price: 240000, buy_price: 3000, factor: 12 } })).error).toMatch(/di bawah.*HPP/i);
      const okLow = convertFinalPrice(base({ unit: "DUS", raw: "60000", item, unitRow: { sell_price: 240000, buy_price: 3000, factor: 12 } }));
      expect(okLow).toMatchObject({ ok: true });
      expect("warning" in (okLow as object)).toBe(false);
      // own 150000 > base x factor 60000: follows base x factor, so a final between them (100000) is ACCEPTED and below 60000 is rejected
      const high = { sell_price: 240000, buy_price: 150000, factor: 12 };
      const okHigh = convertFinalPrice(base({ unit: "DUS", raw: "100000", item, unitRow: high }));
      expect(okHigh).toMatchObject({ ok: true });
      expect("warning" in (okHigh as object)).toBe(false);
      expect(fail(base({ unit: "DUS", raw: "59999", item, unitRow: high })).error).toMatch(/60\.000/);
    });
    it("derived unit: base buy missing/0 + own buy > 0 uses the own buy as best-effort known cost", () => {
      const unitRow = { sell_price: 240000, buy_price: 50000, factor: 12 };
      for (const buy_price of [0, "0.00", null, undefined, ""]) {
        const item = { ...base().item, buy_price };
        expect(fail(base({ unit: "DUS", raw: "49999", item, unitRow })).error).toMatch(/50\.000/);
        const ok = convertFinalPrice(base({ unit: "DUS", raw: "55000", item, unitRow }));
        expect(ok).toMatchObject({ ok: true });
        expect("warning" in (ok as object)).toBe(false);
      }
    });
    it("derived unit: base buy known but factor missing/invalid falls back to own buy (unchanged), else warns", () => {
      const item = { ...base().item, buy_price: 5000 };
      for (const factor of [undefined, null, 0, "0.0000", -2]) {
        expect(fail(base({ unit: "DUS", raw: "1000", item, unitRow: { sell_price: 240000, buy_price: 150000, factor } })).error).toMatch(/150\.000/);
      }
    });
    it.each([[-5], ["abc"], ["5000abc"], [1500.005], ["1,5"], [Infinity]])("a malformed non-empty master cost %j is an ERROR, never a warning", bad => {
      expect(fail(base({ raw: "100", item: { ...base().item, buy_price: bad as never } })).error).toBe("Harga beli master tidak valid");
      expect(fail(base({ unit: "DUS", raw: "1000", unitRow: { sell_price: 240000, buy_price: bad as never, factor: 12 } })).error).toBe("Harga beli master tidak valid");
      expect(fail(base({ unit: "DUS", raw: "1000", item: { ...base().item, buy_price: bad as never }, unitRow: { sell_price: 240000, buy_price: 0, factor: 12 } })).error).toBe("Harga beli master tidak valid");
    });
    it("empty-ish costs (0, '0.00', null, undefined, '', whitespace) are still just missing -> warning", () => {
      for (const buy_price of [0, "0.00", null, undefined, "", "  "]) {
        expect(convertFinalPrice(base({ raw: "100", item: { ...base().item, buy_price } }))).toMatchObject({ ok: true, warning: MISSING_COST_WARNING });
      }
    });
    it("does not apply to services, but refuses packages (cost cannot be determined here)", () => {
      expect(convertFinalPrice(base({ raw: "100", item: { ...base().item, item_type: "Jasa", buy_price: 0 } }))).toMatchObject({ ok: true });
      expect(fail(base({ item: { ...base().item, item_type: "Grup" } })).error).toMatch(/paket/i);
      expect(fail(base({ item: { ...base().item, item_type: "Grup", buy_price: 0 } })).error).toMatch(/paket/i);
      expect(fail(base({ item: { ...base().item, item_type: "", buy_price: 0 } })).error).toMatch(/jenis barang tidak terbaca/i);
      expect(fail(base({ item: { ...base().item, item_type: null } })).error).toMatch(/jenis barang tidak terbaca/i);
    });
    it("Non-Persediaan has no cashier price floor (isPriceFloorGoods = Persediaan/Grup only): no buy price needed", () => {
      const nonStock = { ...base().item, item_type: "Non-Persediaan", buy_price: 0 };
      expect(convertFinalPrice(base({ raw: "100", item: nonStock }))).toMatchObject({ ok: true, potongan: 19900 });
      expect(convertFinalPrice(base({ raw: "100", item: { ...nonStock, buy_price: null } }))).toMatchObject({ ok: true });
      // a Persediaan item with the same missing cost is still rejected
      expect(convertFinalPrice(base({ raw: "100", item: { ...nonStock, item_type: "Persediaan" } }))).toMatchObject({ ok: true, warning: MISSING_COST_WARNING });
      // Jasa / Non-Persediaan never carry the cost warning
      expect("warning" in (convertFinalPrice(base({ raw: "100", item: nonStock })) as object)).toBe(false);
      expect("warning" in (convertFinalPrice(base({ raw: "100", item: { ...nonStock, item_type: "Jasa" } })) as object)).toBe(false);
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
  it("real screenshot fixture: Persediaan rows with buy_price '0.00' are valid with a warning, in file order", () => {
    const shot = [
      ["100656", "Accesoris Bazar", "10000", "7000"], ["APL0001", "Apolo House", "10000", "7000"], ["100860", "Botol Minum 125ml", "20000", "14000"],
      ["CRACC0005", "Chiro Plate 11", "25000", "18000"], ["100999", "Barang Contoh Lima", "12000", "9000"],
    ];
    const catalog = shot.map(([code, name, sell], index) => ({ id: `s${index}`, code, name, unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: `${sell}.00`, buy_price: "0.00" }));
    const rows = shot.map(([code, , , final], index) => r(index + 2, code, "PCS", "Harga Akhir", final));
    const result = validatePromoRows(rows, catalog, [], pricing());
    expect(result.reviewed.map(row => row.error)).toEqual([null, null, null, null, null]);
    expect(result.reviewed.map(row => row.warning)).toEqual(Array(5).fill(MISSING_COST_WARNING));
    expect(result.valid).toEqual([
      { code: "100656", unit: "PCS", discount_type: "nominal", discount_value: 3000 },
      { code: "APL0001", unit: "PCS", discount_type: "nominal", discount_value: 3000 },
      { code: "100860", unit: "PCS", discount_type: "nominal", discount_value: 6000 },
      { code: "CRACC0005", unit: "PCS", discount_type: "nominal", discount_value: 7000 },
      { code: "100999", unit: "PCS", discount_type: "nominal", discount_value: 3000 },
    ]);
  });
  it("buy price 8000 and final 7000 is still an error, equal to buy price is still fine, no warning on rows without the gap", () => {
    const one = (buy_price: string) => [{ id: "z", code: "Z-1", name: "Z", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "10000.00", buy_price }];
    const below = validatePromoRows([r(2, "Z-1", "PCS", "Harga Akhir", "7000")], one("8000.00"), [], pricing());
    expect(below.reviewed[0].error).toMatch(/di bawah.*HPP/i);
    expect(below.reviewed[0].warning || null).toBeNull();
    expect(below.valid).toEqual([]);
    const equal = validatePromoRows([r(2, "Z-1", "PCS", "Harga Akhir", "8000")], one("8000.00"), [], pricing());
    expect(equal.reviewed[0]).toMatchObject({ error: null });
    expect(equal.reviewed[0].warning || null).toBeNull();
  });
  it("a Persen/Nominal row and a rejected row never carry the cost warning", () => {
    const catalog = [{ id: "z", code: "Z-1", name: "Z", unit: "PCS", is_active: true, item_type: "Persediaan", sell_price: "10000.00", buy_price: "0.00" }];
    const result = validatePromoRows([r(2, "Z-1", "PCS", "Persen", "10"), r(3, "Z-1", "PCS", "Harga Akhir", "9000")], catalog, [], pricing());
    expect(result.reviewed[0].warning || null).toBeNull();
    expect(result.reviewed[1].error).toMatch(/duplikat/);
    expect(result.reviewed[1].warning || null).toBeNull();
    const grup = validatePromoRows([r(2, "G-1", "PCS", "Harga Akhir", "9000")], [{ ...catalog[0], id: "g", code: "G-1", item_type: "Grup" }], [], pricing());
    expect(grup.reviewed[0].error).toMatch(/paket/i);
    expect(grup.reviewed[0].warning || null).toBeNull();
  });
  it("lists the supported kinds when the kind is unknown", () => {
    const result = validatePromoRows([r(2, "FIKTIF-2", "400gr", "Gratis", "1")], items, units, pricing());
    expect(result.reviewed[0].error).toBe("Jenis diskon harus Persen, Nominal, atau Harga Akhir");
  });
});
