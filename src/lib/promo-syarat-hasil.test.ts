import { describe, expect, it } from "vitest";
import {
  SH_MAX_FORCED_CANDIDATES,
  SH_NILAI_MAX_LINE_QTY,
  SyaratHasilError,
  assertValidSyaratHasilDef,
  calculateSyaratHasil,
  calculateSyaratHasilSafe,
  syaratHasilLinesFromCart,
  validateSyaratHasilDef,
  type SyaratHasilCartLine,
  type SyaratHasilDef,
  type SyaratHasilOptions,
} from "./promo-syarat-hasil";

const BOLT_IKAN = "bolt-ikan", BOLT_DONAT = "bolt-donat", ANC = "anc-creamy", ANC2 = "anc-beef", WHISKAS = "whiskas", KOPI = "kopi";
const ref = (item_id: string, unit = "PCS") => ({ item_id, unit });

const line = (pos: number, item_id: string, qty: number, unit_price: number, extra: Partial<SyaratHasilCartLine> = {}): SyaratHasilCartLine =>
  ({ source_position: pos, item_id, unit: "PCS", qty, unit_price, evidence_ok: true, ...extra });

const nominal = (value: number) => ({ type: "nominal" as const, value });
const percent = (value: number, max_amount?: number) => ({ type: "percent" as const, value, ...(max_amount === undefined ? {} : { max_amount }) });

/** "Beli 2 Bolt (Ikan/Donat campur) -> ANC Creamy Stick -Rp1.000" */
const boltAnc = (over: Partial<SyaratHasilDef> = {}): SyaratHasilDef => ({
  id: "p-bolt-anc", name: "Bolt 2 ANC", repeat: true,
  syarat: [{ kind: "qty", min: 2, items: [ref(BOLT_IKAN), ref(BOLT_DONAT)] }],
  hasil: { items: [ref(ANC)], discount: nominal(1000) },
  ...over,
});

const calc = calculateSyaratHasilSafe;
const lineAt = (r: ReturnType<typeof calc>, pos: number) => {
  const l = r.lines.find((x) => x.source_position === pos);
  if (!l) throw new Error(`no line ${pos}`);
  return l;
};

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object") { Object.values(v as object).forEach(deepFreeze); Object.freeze(v); }
  return v;
}

describe("validateSyaratHasilDef", () => {
  it("accepts the canonical Accurate-style promo", () => {
    expect(validateSyaratHasilDef(boltAnc())).toEqual({ ok: true });
    expect(() => assertValidSyaratHasilDef(boltAnc())).not.toThrow();
  });
  it("accepts nilai rows (whole cart, no items) and percent with cap", () => {
    expect(validateSyaratHasilDef(boltAnc({ syarat: [{ kind: "nilai", min: 100000 }], hasil: { items: [ref(ANC)], reward_qty: 2, discount: percent(50, 5000) } }))).toEqual({ ok: true });
  });
  const bad = (def: unknown, code: string) => {
    const v = validateSyaratHasilDef(def);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe(code);
  };
  it("rejects malformed shapes with typed codes, never a raw TypeError", () => {
    bad(null, "SH_BAD_INPUT");
    bad("x", "SH_BAD_INPUT");
    bad({ ...boltAnc(), id: "" }, "SH_BAD_INPUT");
    bad({ ...boltAnc(), repeat: "yes" }, "SH_BAD_INPUT");
    bad({ ...boltAnc(), surprise: 1 }, "SH_BAD_INPUT");
    bad({ ...boltAnc(), allow_below_hpp: "yes" }, "SH_BAD_INPUT");
    bad({ ...boltAnc(), syarat: [] }, "SH_EMPTY_SYARAT");
    bad({ ...boltAnc(), syarat: undefined }, "SH_EMPTY_SYARAT");
    bad({ ...boltAnc(), hasil: { items: [], discount: nominal(1) } }, "SH_EMPTY_HASIL");
    bad({ ...boltAnc(), hasil: undefined }, "SH_EMPTY_HASIL");
  });
  it("rejects invalid syarat rows", () => {
    const row = (r: unknown) => ({ ...boltAnc(), syarat: [r] });
    bad(row({ kind: "qty", min: 0, items: [ref(BOLT_IKAN)] }), "SH_ROW_INVALID");
    bad(row({ kind: "qty", min: 1.5, items: [ref(BOLT_IKAN)] }), "SH_ROW_INVALID");
    bad(row({ kind: "qty", min: 100_000, items: [ref(BOLT_IKAN)] }), "SH_ROW_INVALID");
    bad(row({ kind: "qty", min: 2, items: [] }), "SH_ROW_INVALID");
    bad(row({ kind: "qty", min: 2, items: [ref(BOLT_IKAN), ref(BOLT_IKAN)] }), "SH_ROW_INVALID");
    bad(row({ kind: "qty", min: 2, items: [{ item_id: "", unit: "PCS" }] }), "SH_ROW_INVALID");
    bad(row({ kind: "qty", min: 2, items: [ref(BOLT_IKAN)], extra: 1 }), "SH_ROW_INVALID");
    bad(row({ kind: "nilai", min: 0 }), "SH_ROW_INVALID");
    bad(row({ kind: "nilai", min: 100_000_000 }), "SH_ROW_INVALID");
    bad(row({ kind: "nilai", min: 10.5 }), "SH_ROW_INVALID");
    bad(row({ kind: "nilai", min: 1000, items: [ref(BOLT_IKAN)] }), "SH_ROW_INVALID"); // Q3: whole cart, no items
    bad(row({ kind: "lain", min: 1 }), "SH_ROW_INVALID");
    bad(row(null), "SH_ROW_INVALID");
  });
  it("enforces size caps (8 rows, 50 items per row, 20 reward items)", () => {
    const r = { kind: "qty" as const, min: 1, items: [ref(BOLT_IKAN)] };
    expect(validateSyaratHasilDef({ ...boltAnc(), syarat: Array.from({ length: 8 }, () => r) }).ok).toBe(true);
    bad({ ...boltAnc(), syarat: Array.from({ length: 9 }, () => r) }, "SH_TOO_LARGE");
    bad({ ...boltAnc(), syarat: [{ kind: "qty", min: 1, items: Array.from({ length: 51 }, (_, i) => ref(`i${i}`)) }] }, "SH_TOO_LARGE");
    bad({ ...boltAnc(), hasil: { items: Array.from({ length: 21 }, (_, i) => ref(`i${i}`)), discount: nominal(1) } }, "SH_TOO_LARGE");
    expect(validateSyaratHasilDef({ ...boltAnc(), hasil: { items: Array.from({ length: 20 }, (_, i) => ref(`i${i}`)), discount: nominal(1) } }).ok).toBe(true);
  });
  it("rejects invalid discounts", () => {
    const h = (discount: unknown, extra: object = {}) => ({ ...boltAnc(), hasil: { items: [ref(ANC)], discount, ...extra } });
    bad(h(nominal(0)), "SH_DISCOUNT_INVALID");
    bad(h(nominal(-5)), "SH_DISCOUNT_INVALID");
    bad(h(nominal(10.5)), "SH_DISCOUNT_INVALID");
    bad(h(nominal(100_000_000)), "SH_DISCOUNT_INVALID");
    bad(h({ type: "nominal", value: 100, max_amount: 50 }), "SH_DISCOUNT_INVALID");
    bad(h(percent(0)), "SH_DISCOUNT_INVALID");
    bad(h(percent(101)), "SH_DISCOUNT_INVALID");
    bad(h(percent(12.5)), "SH_DISCOUNT_INVALID");
    bad(h(percent(10, 0)), "SH_DISCOUNT_INVALID");
    bad(h(percent(10, 1.5)), "SH_DISCOUNT_INVALID");
    bad(h({ type: "free", value: 1 }), "SH_DISCOUNT_INVALID");
    bad(h(undefined), "SH_DISCOUNT_INVALID");
    bad(h(nominal(1000), { reward_qty: 0 }), "SH_DISCOUNT_INVALID");
    bad(h(nominal(1000), { reward_qty: 1000 }), "SH_DISCOUNT_INVALID");
    bad(h(nominal(1000), { reward_qty: 1.5 }), "SH_DISCOUNT_INVALID");
    expect(validateSyaratHasilDef(h(percent(100, 5000))).ok).toBe(true);
  });
  it("assertValidSyaratHasilDef throws SyaratHasilError with the code", () => {
    try { assertValidSyaratHasilDef({ ...boltAnc(), syarat: [] }); throw new Error("no throw"); }
    catch (e) { expect(e).toBeInstanceOf(SyaratHasilError); expect((e as SyaratHasilError).code).toBe("SH_EMPTY_SYARAT"); }
  });
});

describe("worked examples (Andri)", () => {
  it("Bolt Ikan x2 -> ANC Creamy Stick x1 gets Rp1.000 off its NORMAL price; syarat lines untouched", () => {
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(r.discount_total).toBe(1000);
    const anc = lineAt(r, 2);
    expect(anc).toMatchObject({ gross: 15000, discount: 1000, net: 14000, excluded_reason: null });
    expect(lineAt(r, 1)).toMatchObject({ gross: 40000, discount: 0, net: 40000 });
    expect(r.skipped).toEqual([]);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({
      promo_id: "p-bolt-anc", sets_available: 1, sets_consumed: 1, grants: 1, discount_total: 1000, below_hpp_waiver: false,
      syarat_units: [{ source_position: 1, units: 2 }],
      hasil_units: [{ source_position: 2, units: 1, discount_per_unit: 1000, discount: 1000 }],
    });
  });

  it("per-line snapshot data: promo id, syarat sets consumed, per-unit discount", () => {
    const r = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 3, 15000)], [boltAnc()]);
    expect(lineAt(r, 1).claims).toEqual([{ promo_id: "p-bolt-anc", sets_consumed: 2, syarat_units: 4, hasil_units: 0, discount_per_unit: 0, discount: 0 }]);
    expect(lineAt(r, 2).claims).toEqual([{ promo_id: "p-bolt-anc", sets_consumed: 2, syarat_units: 0, hasil_units: 2, discount_per_unit: 1000, discount: 2000 }]);
    expect(lineAt(r, 2)).toMatchObject({ gross: 45000, discount: 2000, net: 43000 });
  });

  it("kelipatan: Bolt x4 + ANC x2 -> both ANC discounted; Bolt x3 + ANC x2 -> only one", () => {
    const four = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 2, 15000)], [boltAnc()]);
    expect(lineAt(four, 2)).toMatchObject({ discount: 2000, net: 28000 });
    expect(four.claims[0]).toMatchObject({ sets_available: 2, sets_consumed: 2, grants: 2 });
    const three = calc([line(1, BOLT_IKAN, 3, 20000), line(2, ANC, 2, 15000)], [boltAnc()]);
    expect(lineAt(three, 2)).toMatchObject({ discount: 1000, net: 29000 });
    expect(three.claims[0]).toMatchObject({ sets_available: 1, sets_consumed: 1, grants: 1 });
    // only the units needed are reserved: the 3rd Bolt stays free for other promos
    expect(three.claims[0].syarat_units).toEqual([{ source_position: 1, units: 2 }]);
  });

  it("without repeat only ONE set applies", () => {
    const r = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 2, 15000)], [boltAnc({ repeat: false })]);
    expect(r.discount_total).toBe(1000);
    expect(r.claims[0]).toMatchObject({ sets_available: 1, sets_consumed: 1, grants: 1 });
  });

  it("reward must be in the cart: no ANC line -> no discount and no auto-added line", () => {
    const lines = [line(1, BOLT_IKAN, 6, 20000)];
    const r = calc(lines, [boltAnc()]);
    expect(r.discount_total).toBe(0);
    expect(r.claims).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(lineAt(r, 1).claims).toEqual([]);
  });

  it("surplus syarat is not wasted: Bolt x4 but ANC x1 -> only 2 Bolt units reserved", () => {
    const r = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(r.claims[0]).toMatchObject({ sets_available: 2, sets_consumed: 1, grants: 1, syarat_units: [{ source_position: 1, units: 2 }] });
  });

  it("mixed variants in the syarat pool count together (Ikan x1 + Donat x1)", () => {
    const r = calc([line(1, BOLT_IKAN, 1, 20000), line(2, BOLT_DONAT, 1, 20000), line(3, ANC, 1, 15000)], [boltAnc()]);
    expect(r.discount_total).toBe(1000);
    expect(r.claims[0].syarat_units).toEqual([{ source_position: 1, units: 1 }, { source_position: 2, units: 1 }]);
  });

  it("syarat units are reserved in source_position order, then item_id", () => {
    const r = calc([line(5, BOLT_DONAT, 1, 20000), line(2, BOLT_IKAN, 2, 20000), line(9, ANC, 1, 15000)], [boltAnc()]);
    // pos 2 (2 units) is first -> satisfies min 2 alone; pos 5 untouched
    expect(r.claims[0].syarat_units).toEqual([{ source_position: 2, units: 2 }]);
    expect(lineAt(r, 5).claims).toEqual([]);
  });

  it("syarat qty in another unit than the pool entry does not count", () => {
    const r = calc([line(1, BOLT_IKAN, 2, 20000, { unit: "KARTON" }), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(r.discount_total).toBe(0);
  });

  it("AND of two syarat rows: both must hold, units of both are reserved", () => {
    const def = boltAnc({ syarat: [
      { kind: "qty", min: 2, items: [ref(BOLT_IKAN), ref(BOLT_DONAT)] },
      { kind: "qty", min: 1, items: [ref(WHISKAS)] },
    ] });
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(3, ANC, 1, 15000)], [def]).discount_total).toBe(0);
    expect(calc([line(2, WHISKAS, 1, 9000), line(3, ANC, 1, 15000)], [def]).discount_total).toBe(0);
    const ok = calc([line(1, BOLT_IKAN, 2, 20000), line(2, WHISKAS, 1, 9000), line(3, ANC, 1, 15000)], [def]);
    expect(ok.discount_total).toBe(1000);
    expect(ok.claims[0].syarat_units).toEqual([{ source_position: 1, units: 2 }, { source_position: 2, units: 1 }]);
  });

  it("AND + kelipatan: sets = the minimum over rows", () => {
    const def = boltAnc({ syarat: [
      { kind: "qty", min: 2, items: [ref(BOLT_IKAN)] },
      { kind: "qty", min: 1, items: [ref(WHISKAS)] },
    ] });
    const r = calc([line(1, BOLT_IKAN, 6, 20000), line(2, WHISKAS, 2, 9000), line(3, ANC, 5, 15000)], [def]);
    expect(r.claims[0]).toMatchObject({ sets_available: 2, sets_consumed: 2, grants: 2, discount_total: 2000 });
  });

  it("overlapping syarat rows of ONE promo reuse the same units first", () => {
    const def = boltAnc({ syarat: [
      { kind: "qty", min: 2, items: [ref(BOLT_IKAN), ref(BOLT_DONAT)] },
      { kind: "qty", min: 1, items: [ref(BOLT_IKAN)] },
    ] });
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)], [def]);
    expect(r.discount_total).toBe(1000);
    expect(r.claims[0].syarat_units).toEqual([{ source_position: 1, units: 2 }]);
  });

  it("nilai belanja is measured on the WHOLE cart (normal price, before discounts), not only syarat items", () => {
    const def = boltAnc({ syarat: [{ kind: "nilai", min: 100000 }] });
    const ok = calc([line(1, KOPI, 1, 85000), line(2, ANC, 1, 15000)], [def]);
    expect(ok.discount_total).toBe(1000); // 85.000 + 15.000 = exactly the minimum
    expect(ok.claims[0].syarat_units).toEqual([]); // nilai reserves nothing
    expect(calc([line(1, KOPI, 1, 84999), line(2, ANC, 1, 15000)], [def]).discount_total).toBe(0); // min - 1
  });

  it("nilai counts every computable line at gross: manual-discount / no-evidence / claimed-elsewhere lines too", () => {
    const def = boltAnc({ syarat: [{ kind: "nilai", min: 100000 }] });
    const r = calc([
      line(1, KOPI, 1, 30000, { manual_discount: true }),
      line(2, WHISKAS, 1, 30000, { evidence_ok: false }),
      line(3, BOLT_IKAN, 2, 20000, { units_claimed_elsewhere: 2 }),
      line(4, ANC, 1, 15000),
    ], [def]);
    expect(r.discount_total).toBe(1000); // 30+30+40+15 = 115k >= 100k
  });

  it("nilai kelipatan: floor(cart / min) sets", () => {
    const def = boltAnc({ syarat: [{ kind: "nilai", min: 100000 }] });
    const r = calc([line(1, KOPI, 1, 235000), line(2, ANC, 5, 15000)], [def]); // 310k -> 3 sets
    expect(r.claims[0]).toMatchObject({ sets_available: 3, sets_consumed: 3, grants: 3, discount_total: 3000 });
  });

  it("AND of qty + nilai: one failing row -> no promo", () => {
    const def = boltAnc({ syarat: [{ kind: "qty", min: 2, items: [ref(BOLT_IKAN)] }, { kind: "nilai", min: 200000 }] });
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)], [def]).discount_total).toBe(0);
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, KOPI, 1, 150000), line(3, ANC, 1, 15000)], [def]).discount_total).toBe(1000);
  });

  it("percent with a Rp cap, applied per REWARD UNIT", () => {
    const def = boltAnc({ hasil: { items: [ref(ANC)], discount: percent(50, 5000) } });
    const r = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 2, 15000)], [def]);
    expect(lineAt(r, 2)).toMatchObject({ discount: 10000, net: 20000 }); // 7.500 -> capped 5.000, x2 units
    expect(r.claims[0].hasil_units[0]).toMatchObject({ discount_per_unit: 5000 });
    // below the cap: not inflated
    const cheap = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 8000)], [def]);
    expect(lineAt(cheap, 2).discount).toBe(4000);
  });

  it("percent rounds half up per unit, no float drift; percent without cap is uncapped", () => {
    const def = boltAnc({ hasil: { items: [ref(ANC)], discount: percent(10) } });
    expect(lineAt(calc([line(1, BOLT_IKAN, 2, 1), line(2, ANC, 1, 15005)], [def]), 2).discount).toBe(1501); // 1500.5 -> 1501
    expect(lineAt(calc([line(1, BOLT_IKAN, 2, 1), line(2, ANC, 1, 15004)], [def]), 2).discount).toBe(1500); // 1500.4
    const full = boltAnc({ hasil: { items: [ref(ANC)], discount: percent(100) } });
    expect(lineAt(calc([line(1, BOLT_IKAN, 2, 1), line(2, ANC, 1, 15000)], [full]), 2)).toMatchObject({ discount: 14999, net: 1 }); // never free
  });

  it("net of a reward unit stays > 0: nominal larger than the price is clamped to price-1; price<=1 is not a reward", () => {
    const def = boltAnc({ hasil: { items: [ref(ANC)], discount: nominal(1000) } });
    expect(lineAt(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 800)], [def]), 2)).toMatchObject({ discount: 799, net: 1 });
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 1)], [def]).discount_total).toBe(0);
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 0)], [def]).discount_total).toBe(0);
  });

  it("reward_qty: units discounted per set, partial grant when fewer reward units exist", () => {
    const def = boltAnc({ hasil: { items: [ref(ANC)], reward_qty: 2, discount: nominal(1000) } });
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 3, 15000)], [def]);
    expect(r.claims[0]).toMatchObject({ sets_consumed: 1, grants: 2, discount_total: 2000 });
    const partial = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)], [def]);
    expect(partial.claims[0]).toMatchObject({ sets_consumed: 1, grants: 1, discount_total: 1000 });
  });

  it("reward units may be any variant in the hasil pool; lowest resulting discount first, ties by source_position", () => {
    const def = boltAnc({ hasil: { items: [ref(ANC), ref(ANC2)], discount: percent(10) } });
    // ANC 15.000 -> 1.500, ANC2 12.000 -> 1.200: the cheaper discount goes first
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000), line(3, ANC2, 1, 12000)], [def]);
    expect(r.claims[0].hasil_units).toEqual([{ source_position: 3, units: 1, discount_per_unit: 1200, discount: 1200 }]);
    // equal discounts (nominal): earliest source_position
    const eq = calc([line(1, BOLT_IKAN, 2, 20000), line(7, ANC2, 1, 12000), line(4, ANC, 1, 15000)], [boltAnc({ hasil: { items: [ref(ANC), ref(ANC2)], discount: nominal(1000) } })]);
    expect(eq.claims[0].hasil_units).toEqual([{ source_position: 4, units: 1, discount_per_unit: 1000, discount: 1000 }]);
    // two sets over two variants
    const two = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 1, 15000), line(3, ANC2, 1, 12000)], [def]);
    expect(two.discount_total).toBe(2700);
  });

  it("the same item as syarat and hasil needs SEPARATE units", () => {
    const def: SyaratHasilDef = { id: "p-same", repeat: false, syarat: [{ kind: "qty", min: 2, items: [ref(BOLT_IKAN)] }], hasil: { items: [ref(BOLT_IKAN)], discount: nominal(1000) } };
    expect(calc([line(1, BOLT_IKAN, 2, 20000)], [def]).discount_total).toBe(0);
    const three = calc([line(1, BOLT_IKAN, 3, 20000)], [def]);
    expect(three.discount_total).toBe(1000);
    expect(three.claims[0]).toMatchObject({ syarat_units: [{ source_position: 1, units: 2 }], hasil_units: [{ source_position: 1, units: 1, discount_per_unit: 1000, discount: 1000 }] });
    expect(lineAt(three, 1).claims).toEqual([{ promo_id: "p-same", sets_consumed: 1, syarat_units: 2, hasil_units: 1, discount_per_unit: 1000, discount: 1000 }]);
  });

  it("circular pools pick the set count that grants the most reward units (6 Bolt, reward_qty 2)", () => {
    const def: SyaratHasilDef = { id: "p-circ", repeat: true, syarat: [{ kind: "qty", min: 2, items: [ref(BOLT_IKAN)] }], hasil: { items: [ref(BOLT_IKAN)], reward_qty: 2, discount: nominal(1000) } };
    const r = calc([line(1, BOLT_IKAN, 6, 20000)], [def]);
    expect(r.claims[0]).toMatchObject({ sets_consumed: 1, grants: 2, discount_total: 2000 });
    const ten = calc([line(1, BOLT_IKAN, 9, 20000)], [def]); // a=2: 4 syarat + 4 reward <= 9
    expect(ten.claims[0]).toMatchObject({ sets_consumed: 2, grants: 4 });
  });

  it("huge quantities are closed-form (no per-unit loops, no precision loss)", () => {
    const r = calc([line(1, BOLT_IKAN, 2_000_000_000_000, 1), line(2, ANC, 300_000_000_000, 15000)], [boltAnc()]);
    expect(r.claims[0]).toMatchObject({ sets_available: 1_000_000_000_000, sets_consumed: 300_000_000_000, grants: 300_000_000_000, discount_total: 300_000_000_000_000 });
    expect(lineAt(r, 2).net).toBe(300_000_000_000 * 14000);
  });
});

describe("below-HPP flag (exposed only; floor enforcement is a later stage)", () => {
  it("allow_below_hpp true -> reward line + claim flagged; syarat line and default promos are not", () => {
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)], [boltAnc({ allow_below_hpp: true })]);
    expect(r.claims[0].below_hpp_waiver).toBe(true);
    expect(lineAt(r, 2).below_hpp_waiver).toBe(true);
    expect(lineAt(r, 1).below_hpp_waiver).toBe(false);
    const plain = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(plain.claims[0].below_hpp_waiver).toBe(false);
    expect(lineAt(plain, 2).below_hpp_waiver).toBe(false);
  });
  it("a waiver promo that did not discount a line does not flag it", () => {
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000)], [boltAnc({ allow_below_hpp: true })]);
    expect(lineAt(r, 3).below_hpp_waiver).toBe(false);
  });
});

describe("line eligibility", () => {
  it("manual-discounted lines are excluded and returned unchanged (gross = net)", () => {
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000, { manual_discount: true })], [boltAnc()]);
    expect(r.discount_total).toBe(0);
    expect(lineAt(r, 2)).toMatchObject({ excluded_reason: "manual_discount", gross: 15000, net: 15000, discount: 0, claims: [] });
    const manualSyarat = calc([line(1, BOLT_IKAN, 2, 20000, { manual_discount: true }), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(manualSyarat.discount_total).toBe(0);
  });
  it("lines without official-price evidence never take part (fail closed, e.g. clinic)", () => {
    const r = calc([line(1, BOLT_IKAN, 2, 20000, { evidence_ok: false }), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(r.discount_total).toBe(0);
    expect(lineAt(r, 1).excluded_reason).toBe("no_evidence");
    const undef = calc([line(1, BOLT_IKAN, 2, 20000, { evidence_ok: undefined }), line(2, ANC, 1, 15000)], [boltAnc()]);
    expect(undef.discount_total).toBe(0);
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000, { evidence_ok: false })], [boltAnc()]).discount_total).toBe(0);
  });
  it("malformed qty/price/item/claimed units: excluded; money null (never a fabricated 0) when not computable", () => {
    const r = calc([
      line(1, BOLT_IKAN, 1.5, 20000), line(2, BOLT_IKAN, 0, 20000), line(3, BOLT_IKAN, 2, -1), line(4, BOLT_IKAN, 2, 1.5),
      line(5, "", 2, 20000), line(6, BOLT_IKAN, 2, 20000, { units_claimed_elsewhere: 3 }), line(7, BOLT_IKAN, 2, 20000, { units_claimed_elsewhere: -1 }),
      line(8, BOLT_IKAN, Number.NaN, 20000),
    ], [boltAnc()]);
    expect(r.lines.map((l) => l.excluded_reason)).toEqual(["invalid_qty", "invalid_qty", "invalid_price", "invalid_price", "invalid_item", "invalid_claimed_units", "invalid_claimed_units", "invalid_qty"]);
    expect(r.lines.slice(0, 4).every((l) => l.gross === null && l.net === null)).toBe(true);
    expect(r.lines[4]).toMatchObject({ gross: 40000, net: 40000 });
    expect(r.discount_total).toBe(0);
  });
  it("units_claimed_elsewhere (e.g. Bolt 2/6 quantity_pool) are not available as syarat or hasil", () => {
    expect(calc([line(1, BOLT_IKAN, 2, 20000, { units_claimed_elsewhere: 1 }), line(2, ANC, 1, 15000)], [boltAnc()]).discount_total).toBe(0);
    expect(calc([line(1, BOLT_IKAN, 3, 20000, { units_claimed_elsewhere: 1 }), line(2, ANC, 1, 15000)], [boltAnc()]).discount_total).toBe(1000);
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 2, 15000, { units_claimed_elsewhere: 1 })], [boltAnc()]).claims[0]).toMatchObject({ grants: 1 });
    expect(calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000, { units_claimed_elsewhere: 1 })], [boltAnc()]).discount_total).toBe(0);
  });
});

describe("conflicts between promos (Q1/Q2)", () => {
  const A = boltAnc({ id: "A", name: "Bolt->ANC 1000" });
  const B = boltAnc({ id: "B", name: "Bolt->Whiskas 3000", hasil: { items: [ref(WHISKAS)], discount: nominal(3000) } });
  const cart = () => [line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000)];

  it("promos on the SAME syarat units: the one that saves the customer the most wins automatically", () => {
    const r = calc(cart(), [A, B]);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["B"]);
    expect(r.discount_total).toBe(3000);
    expect(lineAt(r, 2).discount).toBe(0);
    const alt = Object.fromEntries(r.alternatives.map((a) => [a.promo_id, a]));
    expect(alt.B).toMatchObject({ status: "applied", standalone_savings: 3000, applied_discount: 3000, reduced: false, total_if_forced: 3000, delta_vs_current: 0 });
    expect(alt.A).toMatchObject({ status: "conflict_lost", standalone_savings: 1000, applied_discount: 0, total_if_forced: 1000, delta_vs_current: -2000, conflicts_with: ["B"] });
  });

  it("forced_promo_id lets the cashier override; the loser becomes an alternative with its savings", () => {
    const r = calc(cart(), [A, B], { forced_promo_id: "A" });
    expect(r.claims.map((c) => c.promo_id)).toEqual(["A"]);
    expect(r.discount_total).toBe(1000);
    expect(r.forced).toEqual({ promo_id: "A", applied: true, code: null });
    const alt = Object.fromEntries(r.alternatives.map((a) => [a.promo_id, a]));
    expect(alt.B).toMatchObject({ status: "conflict_lost", standalone_savings: 3000, total_if_forced: 3000, delta_vs_current: 2000 });
  });

  it("excluded_promo_ids cancels a promo (still reported with the savings given up)", () => {
    const r = calc(cart(), [A, B], { excluded_promo_ids: ["B"] });
    expect(r.claims.map((c) => c.promo_id)).toEqual(["A"]);
    const b = r.alternatives.find((a) => a.promo_id === "B");
    expect(b).toMatchObject({ status: "excluded", standalone_savings: 3000, applied_discount: 0, total_if_forced: 3000, delta_vs_current: 2000 });
    expect(calc(cart(), [A, B], { excluded_promo_ids: ["A", "B"] }).discount_total).toBe(0);
  });

  it("promos on DISJOINT units run automatically together (no cashier choice needed)", () => {
    const C: SyaratHasilDef = { id: "C", repeat: true, syarat: [{ kind: "qty", min: 1, items: [ref(WHISKAS)] }], hasil: { items: [ref(KOPI)], discount: nominal(2000) } };
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000), line(4, KOPI, 1, 30000)], [A, C]);
    expect(r.claims.map((c) => c.promo_id).sort()).toEqual(["A", "C"]);
    expect(r.discount_total).toBe(3000);
  });

  it("same promos share a line when units suffice: Bolt x4 serves two promos (2 + 2 units)", () => {
    const r = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000)], [A, B]);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["B", "A"]);
    expect(r.discount_total).toBe(4000);
    expect(lineAt(r, 1).claims.map((c) => [c.promo_id, c.syarat_units])).toEqual([["B", 2], ["A", 2]]);
  });

  it("one_promo_per_line keeps a line with a single promo (for single-promo sale_items)", () => {
    const r = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000)], [A, B], { one_promo_per_line: true });
    expect(r.claims.map((c) => c.promo_id)).toEqual(["B"]);
    for (const l of r.lines) expect(new Set(l.claims.map((c) => c.promo_id)).size).toBeLessThanOrEqual(1);
  });

  it("contested REWARD unit: the bigger saving wins; a partially blocked promo is reported as reduced", () => {
    const C = boltAnc({ id: "C", name: "Whiskas->ANC 2000", syarat: [{ kind: "qty", min: 1, items: [ref(WHISKAS)] }], hasil: { items: [ref(ANC)], discount: nominal(2000) } });
    const one = calc([line(1, BOLT_IKAN, 2, 20000), line(2, WHISKAS, 1, 9000), line(3, ANC, 1, 15000)], [A, C]);
    expect(one.claims.map((c) => c.promo_id)).toEqual(["C"]);
    const two = calc([line(1, BOLT_IKAN, 2, 20000), line(2, WHISKAS, 1, 9000), line(3, ANC, 2, 15000)], [A, C]);
    expect(two.discount_total).toBe(3000); // both fit: 2 ANC units
    const partial = calc([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 1, 15000)], [A, boltAnc({ id: "A2", hasil: { items: [ref(ANC)], discount: nominal(500) } })]);
    expect(partial.claims.map((c) => c.promo_id)).toEqual(["A"]);
    expect(partial.alternatives.find((a) => a.promo_id === "A2")).toMatchObject({ status: "conflict_lost", standalone_savings: 500 });
  });

  it("a unit cannot be syarat for one promo and hasil for another: the bigger saving takes it", () => {
    const D: SyaratHasilDef = { id: "D", repeat: true, syarat: [{ kind: "qty", min: 1, items: [ref(ANC)] }], hasil: { items: [ref(WHISKAS)], discount: nominal(1500) } };
    const r = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000)], [A, D]);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["D"]);
    expect(r.discount_total).toBe(1500);
    const flip = calc([line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000), line(3, WHISKAS, 1, 9000)], [A, D], { forced_promo_id: "A" });
    expect(flip.claims.map((c) => c.promo_id)).toEqual(["A"]);
  });

  it("equal savings tie-break on id (code-unit order), independent of definition order", () => {
    const X = boltAnc({ id: "x-promo", hasil: { items: [ref(ANC)], discount: nominal(1000) } });
    const Y = boltAnc({ id: "y-promo", hasil: { items: [ref(ANC)], discount: nominal(1000) } });
    const cartLines = [line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)];
    expect(calc(cartLines, [X, Y]).claims.map((c) => c.promo_id)).toEqual(["x-promo"]);
    expect(calc(cartLines, [Y, X]).claims.map((c) => c.promo_id)).toEqual(["x-promo"]);
  });

  it("alternatives can be switched off", () => {
    expect(calc(cart(), [A, B], { alternatives: false }).alternatives).toEqual([]);
  });

  it("forced promo problems are reported (caller must fail closed), engine does not throw", () => {
    expect(calc(cart(), [A, B], { forced_promo_id: "nope" }).forced).toEqual({ promo_id: "nope", applied: false, code: "SH_FORCED_NOT_FOUND" });
    const broken = { ...A, id: "Z", syarat: [] } as SyaratHasilDef;
    expect(calc(cart(), [A, broken], { forced_promo_id: "Z" }).forced).toEqual({ promo_id: "Z", applied: false, code: "SH_FORCED_SKIPPED" });
    const none = calc([line(1, BOLT_IKAN, 1, 20000), line(2, ANC, 1, 15000)], [A], { forced_promo_id: "A" });
    expect(none.forced).toEqual({ promo_id: "A", applied: false, code: "SH_FORCED_NOT_APPLICABLE" });
    expect(calc(cart(), [A, B]).forced).toBeNull();
    expect(calc(cart(), [A, B], { forced_promo_id: null }).forced).toBeNull();
  });
});

describe("safe vs strict, skip isolation, errors", () => {
  const cartLines = () => [line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)];
  it("an invalid / stale promo is SKIPPED and reported; other promos still apply", () => {
    const broken = { ...boltAnc({ id: "bad" }), hasil: { items: [ref(ANC)], discount: nominal(0) } } as SyaratHasilDef;
    const r = calc(cartLines(), [broken, boltAnc({ id: "good" })]);
    expect(r.skipped).toEqual([{ promo_id: "bad", code: "SH_DISCOUNT_INVALID" }]);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["good"]);
  });
  it("garbage entries and ids without text are skipped as SH_BAD_INPUT, duplicates are ALL skipped", () => {
    const r = calc(cartLines(), [null as never, { ...boltAnc(), id: "" }, boltAnc({ id: "dup" }), boltAnc({ id: "dup" }), boltAnc({ id: "ok" })]);
    expect(r.skipped).toEqual([
      { promo_id: null, code: "SH_BAD_INPUT" }, { promo_id: null, code: "SH_BAD_INPUT" },
      { promo_id: "dup", code: "SH_DUPLICATE_ID" }, { promo_id: "dup", code: "SH_DUPLICATE_ID" },
    ]);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["ok"]);
  });
  it("a promo whose total overflows while computing is skipped without touching lines", () => {
    // each line's gross stays below 2^53, but the discount SUM of the "big" promo (~1.6e16) cannot
    const big: SyaratHasilDef = { id: "big", repeat: true, syarat: [{ kind: "qty", min: 1, items: [ref(BOLT_IKAN)] }], hasil: { items: [ref(ANC), ref(ANC2)], reward_qty: 999, discount: percent(100) } };
    const r = calc([line(1, BOLT_IKAN, 1_000_000_000, 1), line(2, ANC, 80_000_000, 99_999_999), line(3, ANC2, 80_000_000, 99_999_999)], [big, boltAnc({ id: "small", syarat: [{ kind: "qty", min: 2, items: [ref(BOLT_IKAN)] }] })]);
    expect(r.skipped).toEqual([{ promo_id: "big", code: "SH_OVERFLOW" }]);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["small"]);
    expect(r.discount_total).toBe(80_000_000 * 1000);
  });
  it("a LINE total beyond 2^53: STRICT throws SH_OVERFLOW; SAFE excludes that line (invalid_amount, null gross/net) and still prices the rest", () => {
    expect(() => calculateSyaratHasil([line(1, BOLT_IKAN, Number.MAX_SAFE_INTEGER, 2)], [boltAnc()])).toThrowError(expect.objectContaining({ code: "SH_OVERFLOW" }));
    const r = calc([line(1, BOLT_IKAN, Number.MAX_SAFE_INTEGER, 2), line(2, BOLT_IKAN, 2, 20000), line(3, ANC, 1, 15000)], [boltAnc()]);
    expect(lineAt(r, 1)).toMatchObject({ excluded_reason: "invalid_amount", gross: null, net: null, discount: 0, claims: [] });
    expect(r.discount_total).toBe(1000);
    expect(r.claims[0].syarat_units).toEqual([{ source_position: 2, units: 2 }]);
  });
  it("S1: SAFE never throws for null / non-object lines, non-integer source_position, huge lines, forced+excluded: they are reported with typed codes", () => {
    const good = [line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)];
    const r = calc([null as never, 7 as never, "x" as never, [] as never, line(1.5, KOPI, 1, 100), { ...line(Number.NaN, KOPI, 1, 100) }, ...good], [boltAnc()]);
    expect(r.skipped_lines).toEqual([
      { index: 0, code: "SH_BAD_INPUT" }, { index: 1, code: "SH_BAD_INPUT" }, { index: 2, code: "SH_BAD_INPUT" }, { index: 3, code: "SH_BAD_INPUT" },
      { index: 4, code: "SH_LINE_POSITION_INVALID" }, { index: 5, code: "SH_LINE_POSITION_INVALID" },
    ]);
    expect(r.lines.map((l) => l.source_position)).toEqual([1, 2]);
    expect(r.discount_total).toBe(1000);
    // forced AND excluded: nothing is applied for the forced id, reported in forced.code, no throw
    const fx = calc(good, [boltAnc()], { forced_promo_id: "p-bolt-anc", excluded_promo_ids: ["p-bolt-anc"] });
    expect(fx.forced).toEqual({ promo_id: "p-bolt-anc", applied: false, code: "SH_FORCED_EXCLUDED" });
    expect(fx.discount_total).toBe(0);
    expect(calc(good, [boltAnc()]).skipped_lines).toEqual([]);
  });
  it("S1: STRICT keeps throwing the typed errors", () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(SyaratHasilError); return (e as SyaratHasilError).code; } return "no throw"; };
    const good = [line(1, BOLT_IKAN, 2, 20000), line(2, ANC, 1, 15000)];
    expect(code(() => calculateSyaratHasil([null as never, ...good], [boltAnc()]))).toBe("SH_BAD_INPUT");
    expect(code(() => calculateSyaratHasil([line(1.5, ANC, 1, 1)], [boltAnc()]))).toBe("SH_LINE_POSITION_INVALID");
    expect(code(() => calculateSyaratHasil(good, [boltAnc()], { forced_promo_id: "p-bolt-anc", excluded_promo_ids: ["p-bolt-anc"] }))).toBe("SH_FORCED_EXCLUDED");
  });
  it("S1: SAFE fuzz - garbage lines/options of every kind never throw", () => {
    const junk: unknown[] = [null, undefined, 0, 1.5, "s", true, [], {}, { item_id: 5 }, { item_id: "A", unit: "u", qty: "2", unit_price: 1 }, { item_id: "A", unit: "u", qty: 1e300, unit_price: 1e300 },
      { item_id: "A", unit: "u", qty: 2 ** 40, unit_price: 2 ** 20 }, { item_id: "A", unit: "u", qty: 1, unit_price: 1, source_position: "1" }, { item_id: "A", unit: "u", qty: 1, unit_price: 1, source_position: Infinity },
      { item_id: "A", unit: "u", qty: 1, unit_price: 1, units_claimed_elsewhere: -1 }, { item_id: "A", unit: "u", qty: 1, unit_price: 1, evidence_ok: "yes" }];
    for (const j of junk) {
      expect(() => calc([j as never, line(9, ANC, 1, 15000)], [boltAnc()]), JSON.stringify(j)).not.toThrow();
      expect(() => calc([j as never], [boltAnc()], { alternatives: false, forced_promo_id: "p-bolt-anc", excluded_promo_ids: ["p-bolt-anc"] }), JSON.stringify(j)).not.toThrow();
    }
  });
  it("caller-contract violations throw typed errors", () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { expect(e).toBeInstanceOf(SyaratHasilError); return (e as SyaratHasilError).code; } return "no throw"; };
    expect(code(() => calc("x" as never, [boltAnc()]))).toBe("SH_BAD_INPUT");
    expect(code(() => calc(cartLines(), "x" as never))).toBe("SH_BAD_INPUT");
    expect(code(() => calc([line(1, ANC, 1, 1), line(1, KOPI, 1, 1)], [boltAnc()]))).toBe("SH_LINE_POSITION_DUPLICATE");
    expect(code(() => calc(cartLines(), [boltAnc()], "x" as never))).toBe("SH_BAD_INPUT");
    expect(code(() => calc(cartLines(), [boltAnc()], { excluded_promo_ids: "x" as never }))).toBe("SH_BAD_INPUT");
    expect(code(() => calc(cartLines(), [boltAnc()], { forced_promo_id: 5 as never }))).toBe("SH_BAD_INPUT");
    expect(code(() => calc(Array.from({ length: 2001 }, (_, i) => line(i, ANC, 1, 1)), [boltAnc()]))).toBe("SH_TOO_LARGE");
    expect(code(() => calc(cartLines(), Array.from({ length: 65 }, (_, i) => boltAnc({ id: `p${i}` }))))).toBe("SH_TOO_LARGE");
  });
  it("strict calculateSyaratHasil throws on the first invalid/duplicate promo", () => {
    expect(() => calculateSyaratHasil(cartLines(), [{ ...boltAnc(), syarat: [] } as SyaratHasilDef])).toThrowError(expect.objectContaining({ code: "SH_EMPTY_SYARAT" }));
    expect(() => calculateSyaratHasil(cartLines(), [boltAnc(), boltAnc()])).toThrowError(expect.objectContaining({ code: "SH_DUPLICATE_ID" }));
    expect(calculateSyaratHasil(cartLines(), [boltAnc()]).discount_total).toBe(1000);
  });
  it("source_position defaults to the array index", () => {
    const r = calc([{ item_id: BOLT_IKAN, unit: "PCS", qty: 2, unit_price: 20000, evidence_ok: true }, { item_id: ANC, unit: "PCS", qty: 1, unit_price: 15000, evidence_ok: true }], [boltAnc()]);
    expect(r.lines.map((l) => l.source_position)).toEqual([0, 1]);
    expect(r.discount_total).toBe(1000);
  });
});

describe("purity and determinism", () => {
  it("never mutates its inputs (deep-frozen inputs do not throw) and returns fresh objects", () => {
    const lines = deepFreeze([line(1, BOLT_IKAN, 4, 20000), line(2, ANC, 2, 15000)]);
    const defs = deepFreeze([boltAnc(), boltAnc({ id: "z" })]);
    const opts = deepFreeze({ excluded_promo_ids: ["z"] } as SyaratHasilOptions);
    const before = JSON.stringify([lines, defs, opts]);
    const a = calc(lines, defs, opts);
    expect(JSON.stringify([lines, defs, opts])).toBe(before);
    expect(JSON.stringify(calc(lines, defs, opts))).toBe(JSON.stringify(a));
  });
  it("same result per source_position regardless of line / promo input order", () => {
    const lines = [line(1, BOLT_IKAN, 3, 20000), line(2, BOLT_DONAT, 2, 20000), line(3, ANC, 2, 15000), line(4, WHISKAS, 1, 9000)];
    const defs = [
      boltAnc({ id: "a" }),
      boltAnc({ id: "b", hasil: { items: [ref(WHISKAS)], discount: nominal(3000) } }),
      boltAnc({ id: "c", syarat: [{ kind: "nilai", min: 50000 }], hasil: { items: [ref(ANC)], discount: percent(20, 2000) } }),
    ];
    const base = JSON.stringify(calc(lines, defs));
    expect(JSON.stringify(calc([...lines].reverse(), defs))).toBe(base);
    expect(JSON.stringify(calc(lines, [...defs].reverse()))).toBe(base);
    expect(JSON.stringify(calc([lines[2], lines[0], lines[3], lines[1]], [defs[1], defs[2], defs[0]]))).toBe(base);
  });
});

describe("syaratHasilLinesFromCart (adapter for the later promo-hitung wiring)", () => {
  it("maps BarisKeranjang-shaped rows; evidence only with faktor + official price match", () => {
    const [ok, noFaktor, tier, manual, discounted] = syaratHasilLinesFromCart([
      { item_id: ANC, qty: 1, harga: 15000, satuan: "PCS", faktor: 1, officialPrice: 15000 },
      { item_id: ANC, qty: 1, harga: 15000, satuan: "PCS" }, // clinic: no evidence
      { item_id: ANC, qty: 1, harga: 14000, satuan: "PCS", faktor: 1, officialPrice: 15000 }, // tier/negotiated price
      { item_id: ANC, qty: 1, harga: 15000, satuan: "PCS", faktor: 1, officialPrice: 15000, manualOverride: true },
      { item_id: ANC, qty: 1, harga: 15000, satuan: "PCS", faktor: 1, officialPrice: 15000, item_discount_type: "percent", item_discount_value: 10 },
    ]);
    expect(ok).toMatchObject({ source_position: 0, item_id: ANC, unit: "PCS", qty: 1, unit_price: 15000, evidence_ok: true, manual_discount: false });
    expect(noFaktor.evidence_ok).toBe(false);
    expect(tier.evidence_ok).toBe(false);
    expect(manual.manual_discount).toBe(true);
    expect(discounted.manual_discount).toBe(true);
    expect([ok, noFaktor, tier, manual, discounted].map((l) => l.source_position)).toEqual([0, 1, 2, 3, 4]);
  });
  it("end to end: clinic rows (no faktor/officialPrice) never get a discount", () => {
    const lines = syaratHasilLinesFromCart([{ item_id: BOLT_IKAN, qty: 2, harga: 20000, satuan: "PCS" }, { item_id: ANC, qty: 1, harga: 15000, satuan: "PCS" }]);
    expect(calc(lines, [boltAnc()]).discount_total).toBe(0);
    const kasir = syaratHasilLinesFromCart([
      { item_id: BOLT_IKAN, qty: 2, harga: 20000, satuan: "PCS", faktor: 1, officialPrice: 20000 },
      { item_id: ANC, qty: 1, harga: 15000, satuan: "PCS", faktor: 1, officialPrice: 15000 },
    ]);
    expect(calc(kasir, [boltAnc()]).discount_total).toBe(1000);
  });
  it("rejects non-array input with a typed error", () => {
    expect(() => syaratHasilLinesFromCart("x" as never)).toThrowError(expect.objectContaining({ code: "SH_BAD_INPUT" }));
  });
});

describe("G1: best-of 'each applicable promo forced first' beats pure greedy", () => {
  // review counterexample: A1 (Y1+Y2 -> Z1, Rp100) blocks B1 (Y1 -> Z2, Rp90) + B2 (Y2 -> Z3, Rp90) = Rp180
  const A1: SyaratHasilDef = { id: "A1", repeat: false, syarat: [{ kind: "qty", min: 1, items: [ref("Y1")] }, { kind: "qty", min: 1, items: [ref("Y2")] }], hasil: { items: [ref("Z1")], discount: nominal(100) } };
  const one = (id: string, y: string, z: string, v: number): SyaratHasilDef => ({ id, repeat: false, syarat: [{ kind: "qty", min: 1, items: [ref(y)] }], hasil: { items: [ref(z)], discount: nominal(v) } });
  const B1 = one("B1", "Y1", "Z2", 90), B2 = one("B2", "Y2", "Z3", 90);
  const cart = () => ["Y1", "Y2", "Z1", "Z2", "Z3"].map((id, i) => line(i, id, 1, 1000));

  it("auto mode finds B1+B2 = 180 instead of the greedy A1 = 100", () => {
    const r = calc(cart(), [A1, B1, B2]);
    expect(r.discount_total).toBe(180);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["B1", "B2"]); // tie B1-first vs B2-first -> smaller id leads
    expect(r.forced).toBeNull();
    const alt = Object.fromEntries(r.alternatives.map((a) => [a.promo_id, a]));
    expect(alt.A1).toMatchObject({ status: "conflict_lost", standalone_savings: 100, total_if_forced: 100, delta_vs_current: -80, conflicts_with: ["B1", "B2"] });
    expect(alt.B1).toMatchObject({ status: "applied", total_if_forced: 180, delta_vs_current: 0 });
  });
  it("conflict_strategy 'greedy' keeps the old pure-greedy result (A1 = 100) - used as the baseline in property tests", () => {
    const r = calc(cart(), [A1, B1, B2], { conflict_strategy: "greedy" });
    expect(r.discount_total).toBe(100);
    expect(r.claims.map((c) => c.promo_id)).toEqual(["A1"]);
  });
  it("forced_promo_id keeps its meaning: the forced promo claims first, the rest is greedy", () => {
    const r = calc(cart(), [A1, B1, B2], { forced_promo_id: "A1" });
    expect(r.claims.map((c) => c.promo_id)).toEqual(["A1"]);
    expect(r.discount_total).toBe(100);
    expect(r.forced).toEqual({ promo_id: "A1", applied: true, code: null });
    expect(calc(cart(), [A1, B1, B2], { forced_promo_id: "B2" }).claims.map((c) => c.promo_id)).toEqual(["B2", "B1"]);
  });
  it("excluded_promo_ids still removes a promo from every candidate run", () => {
    const r = calc(cart(), [A1, B1, B2], { excluded_promo_ids: ["B2"] });
    expect(r.claims.map((c) => c.promo_id)).not.toContain("B2");
    expect(r.discount_total).toBe(100); // B1 alone = 90 < A1 = 100
    expect(r.claims.map((c) => c.promo_id)).toEqual(["A1"]);
    expect(r.alternatives.find((a) => a.promo_id === "B2")).toMatchObject({ status: "excluded", total_if_forced: 180 });
  });
  it("result never depends on the alternatives flag or on input order, also beyond the candidate cap (bounded: 16 candidates)", () => {
    const fillers = Array.from({ length: 30 }, (_, i) => one(`F${String(i).padStart(2, "0")}`, `FY${i}`, `FZ${i}`, 500 + i));
    const lines = [...cart(), ...fillers.flatMap((f, i) => [line(100 + i * 2, `FY${i}`, 1, 5000), line(101 + i * 2, `FZ${i}`, 1, 5000)])];
    const defs = [A1, B1, B2, ...fillers];
    const a = calc(lines, defs);
    const b = calc(lines, defs, { alternatives: false });
    expect(a.discount_total).toBe(b.discount_total);
    expect(JSON.stringify(a.claims)).toBe(JSON.stringify(b.claims));
    expect(JSON.stringify(calc([...lines].reverse(), [...defs].reverse()).claims)).toBe(JSON.stringify(a.claims));
    expect(a.discount_total).toBeGreaterThanOrEqual(calc(lines, defs, { conflict_strategy: "greedy" }).discount_total);
    expect(SH_MAX_FORCED_CANDIDATES).toBe(16);
  });
});

describe("R1: nilai-belanja counts each line at the LESSER of qty x official price and what the customer is actually charged", () => {
  const nilaiPromo: SyaratHasilDef = { id: "N", repeat: false, syarat: [{ kind: "nilai", min: 60000 }], hasil: { items: [ref(ANC)], discount: nominal(1000) } };
  const row = (item_id: string, qty: number, harga: number, officialPrice: number, extra: Record<string, unknown> = {}) =>
    ({ item_id, qty, harga, satuan: "PCS", faktor: 1, officialPrice, ...extra });
  const anc = row(ANC, 1, 15000, 15000);
  const discountOf = (rows: ReturnType<typeof row>[], def: SyaratHasilDef = nilaiPromo) => calc(syaratHasilLinesFromCart(rows), [def]).discount_total;

  describe("engine (charged)", () => {
    it("a line counts at min(gross, charged): a fake-cheap or free line cannot carry the threshold", () => {
      const cheap = calc([line(0, WHISKAS, 1, 600000, { charged: 1 }), line(1, ANC, 1, 15000)], [nilaiPromo]);
      expect(cheap.discount_total).toBe(0); // 1 + 15000 < 60000 although the master price is 600000
      expect(calc([line(0, WHISKAS, 1, 600000, { charged: 0 }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(0);
      expect(calc([line(0, WHISKAS, 1, 600000, { charged: 45000 }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(1000); // 45000 + 15000 = exactly 60000
      expect(calc([line(0, WHISKAS, 1, 600000, { charged: 44999 }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(0);
    });
    it("charged above the official gross never counts more than the gross (overcharge adds nothing)", () => {
      expect(calc([line(0, KOPI, 1, 50000, { charged: 90000 }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(1000); // 65000
      const at70 = { ...nilaiPromo, syarat: [{ kind: "nilai" as const, min: 70000 }] };
      expect(calc([line(0, KOPI, 1, 50000, { charged: 90000 }), line(1, ANC, 1, 15000)], [at70]).discount_total).toBe(0);
    });
    it("charged absent = the line counts at qty x unit_price (direct engine callers vouch for unit_price; the adapter always sets charged)", () => {
      expect(calc([line(0, KOPI, 1, 50000), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(1000);
    });
    it("an invalid charged (negative, fractional, NaN, Infinity, beyond 2^53) counts 0: fail closed", () => {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
        expect(calc([line(0, KOPI, 1, 50000, { charged: bad }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total, String(bad)).toBe(0);
      }
    });
    it("per-line quantity bound: a line of SH_NILAI_MAX_LINE_QTY (1,000,000) units or more counts 0, 999,999 still counts", () => {
      expect(SH_NILAI_MAX_LINE_QTY).toBe(1_000_000);
      expect(calc([line(0, WHISKAS, 1_000_000, 1, { charged: 1_000_000 }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(0);
      expect(calc([line(0, WHISKAS, 1_000_000, 600000), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(0);
      expect(calc([line(0, WHISKAS, 999_999, 1, { charged: 999_999 }), line(1, ANC, 1, 15000)], [nilaiPromo]).discount_total).toBe(1000);
    });
    it("manual-discount / no-evidence / claimed-elsewhere lines still count, at their charged amount", () => {
      const r = calc([
        line(1, KOPI, 1, 30000, { manual_discount: true, charged: 20000 }),
        line(2, WHISKAS, 1, 30000, { evidence_ok: false, charged: 30000 }),
        line(3, BOLT_IKAN, 2, 20000, { units_claimed_elsewhere: 2, charged: 36000 }),
        line(4, ANC, 1, 15000),
      ], [nilaiPromo]);
      expect(r.discount_total).toBe(1000); // 20000 + 30000 + 36000 + 15000 = 101000 >= 60000
      const short = calc([
        line(1, KOPI, 1, 30000, { manual_discount: true, charged: 0 }),
        line(2, WHISKAS, 1, 30000, { evidence_ok: false, charged: 10000 }),
        line(3, BOLT_IKAN, 2, 20000, { units_claimed_elsewhere: 2, charged: 34999 }),
        line(4, ANC, 1, 15000),
      ], [nilaiPromo]);
      expect(short.discount_total).toBe(0); // 0 + 10000 + 34999 + 15000 = 59999
      expect(lineAt(r, 1).gross).toBe(30000); // display gross is untouched
    });
    it("nilai kelipatan uses the charged sum (sets = floor(counted / min))", () => {
      const def = boltAnc({ syarat: [{ kind: "nilai", min: 100000 }] });
      const r = calc([line(1, KOPI, 1, 235000, { charged: 200000 }), line(2, ANC, 5, 15000)], [def]); // 200000 + 75000 = 275000 -> 2 sets
      expect(r.claims[0]).toMatchObject({ sets_available: 2, sets_consumed: 2, grants: 2 });
    });
    it("R1 attack (X1): a fake free service line cannot inflate the sets of a nilai-only waiver promo (below-HPP reward units)", () => {
      const waiver: SyaratHasilDef = { id: "W", repeat: true, allow_below_hpp: true, syarat: [{ kind: "nilai", min: 500000 }], hasil: { items: [ref(ANC)], discount: nominal(5000) } };
      const reward = line(1, ANC, 50, 15000); // 750000 of genuinely charged reward-item units = 1 set, whatever the fake lines say
      for (const charged of [0, 1]) {
        const attack = calc([line(0, "jasa", 1_000_000, 600000, { charged }), reward], [waiver]);
        expect(attack.claims[0], `qty 1e6 charged ${charged}`).toMatchObject({ sets_available: 1, sets_consumed: 1, grants: 1, discount_total: 5000 });
      }
      expect(calc([line(0, "jasa", 1, 600000, { charged: 1 }), reward], [waiver]).claims[0]).toMatchObject({ sets_available: 1, grants: 1 });
      const real = calc([line(0, "jasa", 1, 600000, { charged: 600000 }), reward], [waiver]); // a genuinely paid service: 1,350,000 -> 2 sets
      expect(real.claims[0]).toMatchObject({ sets_available: 2, sets_consumed: 2, grants: 2, below_hpp_waiver: true });
      const unbounded = calc([line(0, "jasa", 1_000_000, 600000), reward], [waiver]); // charged absent: still capped by the quantity bound
      expect(unbounded.claims[0]).toMatchObject({ sets_available: 1 });
    });
  });

  describe("adapter (syaratHasilLinesFromCart)", () => {
    it("charged = qty x harga minus the manual / item discount, never negative; unit_price stays the official price", () => {
      const [manual, pct, nom, tier] = syaratHasilLinesFromCart([
        row(WHISKAS, 1, 1000, 50000, { manualOverride: true }), // cashier typed Rp1.000
        row(KOPI, 1, 9000, 10000, { item_discount_type: "percent", item_discount_value: 10 }),
        row(KOPI, 3, 10000, 10000, { item_discount_type: "nominal", item_discount_value: 40000 }),
        row(WHISKAS, 2, 20000, 25000),
      ]);
      expect(manual).toMatchObject({ unit_price: 50000, charged: 1000, manual_discount: true });
      expect(pct).toMatchObject({ unit_price: 10000, charged: 8100 }); // 9000 - round(9000 x 10%)
      expect(nom).toMatchObject({ unit_price: 10000, charged: 0 }); // 30000 - least(40000, 30000)
      expect(tier).toMatchObject({ unit_price: 25000, charged: 40000 });
    });
    it("percent rounds half-up like the database (round(gross x pct / 100)) and a non-percent type is nominal", () => {
      const [a, b] = syaratHasilLinesFromCart([
        row(KOPI, 1, 1005, 1005, { item_discount_type: "percent", item_discount_value: 10 }), // 100.5 -> 101
        row(KOPI, 1, 1000, 1000, { item_discount_type: "amount", item_discount_value: 300 }),
      ]);
      expect(a.charged).toBe(1005 - 101);
      expect(b.charged).toBe(700);
    });
    it("a manual discount wins over promoDiscount; otherwise a server-derived promoDiscount (Bolt pool etc.) is subtracted", () => {
      const [p, m] = syaratHasilLinesFromCart([
        row(BOLT_IKAN, 2, 20000, 20000, { promoDiscount: 5000 }),
        row(BOLT_IKAN, 2, 20000, 20000, { promoDiscount: 5000, item_discount_type: "nominal", item_discount_value: 1000 }),
      ]);
      expect(p.charged).toBe(35000);
      expect(m.charged).toBe(39000);
    });
    it("rows without an official price (clinic, free text) count 0 toward nilai, not harga", () => {
      const lines = syaratHasilLinesFromCart([{ item_id: "klinik", qty: 1, harga: 70000, satuan: "PCS" }, anc]);
      expect(lines[0]).toMatchObject({ unit_price: 70000, charged: 0 });
      expect(calc(lines, [nilaiPromo]).discount_total).toBe(0); // 15000 only
    });
    it("a charged amount beyond 2^53 or a non-finite discount maps to charged 0 (fail closed)", () => {
      const [big, nan] = syaratHasilLinesFromCart([
        row(KOPI, 4_000_000_000, 4_000_000_000, 4_000_000_000),
        row(KOPI, 1, 5000, 5000, { item_discount_type: "percent", item_discount_value: Number.NaN }),
      ]);
      expect(big.charged).toBe(0);
      expect(nan.charged).toBe(0);
    });
    it("end to end: the reviewed attacks do not satisfy a nilai syarat", () => {
      expect(discountOf([row("jasa", 1, 1, 600000), anc])).toBe(0);                                          // harga 1
      expect(discountOf([row("jasa", 1, 600000, 600000, { item_discount_type: "percent", item_discount_value: 100 }), anc])).toBe(0); // 100% discount
      expect(discountOf([row("jasa", 1_000_000, 0, 600000), anc])).toBe(0);                                   // qty 1e6 at harga 0
      expect(discountOf([row("jasa", 1, 600000, 600000, { manualOverride: true, harga: 1 }), anc])).toBe(0);  // manual override
    });
    it("end to end: legit carts are not falsely refused (branch/tier price, derived unit, genuinely discounted line)", () => {
      expect(discountOf([row(KOPI, 5, 100000, 100000), anc])).toBe(1000);                                    // branch price counted at official
      expect(discountOf([row(KOPI, 1, 500000, 500000, { satuan: "SAK", faktor: 25 }), anc])).toBe(1000);       // derived unit at its own price
      expect(discountOf([row(KOPI, 1, 50000, 50000, { item_discount_type: "percent", item_discount_value: 10 }), anc])).toBe(1000); // 45000 + 15000 = 60000
      expect(discountOf([row(KOPI, 1, 50000, 50000, { item_discount_type: "percent", item_discount_value: 11 }), anc])).toBe(0);     // 44500 + 15000 < 60000: documented refinement
      expect(discountOf([row(KOPI, 1, 80000, 100000), anc])).toBe(1000);                                     // tier price below official counts at what is paid (80000 + 15000)
      expect(discountOf([row(KOPI, 1, 120000, 100000), anc])).toBe(1000);                                    // overcharge counts at official only
    });
  });
});

describe("S3: performance guard (alternatives are the expensive part)", () => {
  const mkPromo = (i: number): SyaratHasilDef => ({
    id: `P${String(i).padStart(3, "0")}`, repeat: true,
    syarat: Array.from({ length: 8 }, (_, r) => ({ kind: "qty" as const, min: 1 + r, items: Array.from({ length: 50 }, (_, k) => ref(`I${(i + r * 7 + k) % 400}`)) })),
    hasil: { items: Array.from({ length: 20 }, (_, k) => ref(`I${(i * 3 + k) % 400}`)), reward_qty: 2, discount: percent(20) },
  });
  const lines = () => Array.from({ length: 200 }, (_, i) => line(i, `I${i % 400}`, 1 + (i % 5) * 1_000_000, 1000 + i));
  it("64 promos x 200 lines (8 rows x 50 items each) WITH alternatives stays under 1.5s", () => {
    const defs = Array.from({ length: 64 }, (_, i) => mkPromo(i));
    const ls = lines();
    calc(ls.slice(0, 20), defs.slice(0, 4)); // warm-up (JIT)
    let ms = Infinity, r = calc(ls.slice(0, 1), defs.slice(0, 1));
    for (let k = 0; k < 2; k++) { // best of 2: guards the algorithm, not a noisy CI neighbour
      const t0 = performance.now();
      r = calc(ls, defs);
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(JSON.stringify({ perf_64x200_alternatives_ms: Math.round(ms), alternatives: r.alternatives.length, total: r.discount_total }));
    expect(r.alternatives.length).toBe(64);
    expect(ms).toBeLessThan(1500);
  });
  it("alternatives:false is the checkout fast path: same result, never slower than the full run", () => {
    const defs = Array.from({ length: 64 }, (_, i) => mkPromo(i));
    const ls = lines();
    const t0 = performance.now(); const full = calc(ls, defs); const tFull = performance.now() - t0;
    const t1 = performance.now(); const fast = calc(ls, defs, { alternatives: false }); const tFast = performance.now() - t1;
    console.log(JSON.stringify({ perf_full_ms: Math.round(tFull), perf_fast_ms: Math.round(tFast) }));
    expect(fast.discount_total).toBe(full.discount_total);
    expect(JSON.stringify(fast.claims)).toBe(JSON.stringify(full.claims));
    expect(fast.alternatives).toEqual([]);
    expect(tFast).toBeLessThanOrEqual(tFull * 1.2 + 50);
  });
});

describe("stage-1 review v2 residuals", () => {
  const D = "D", A = "A", B = "B";
  it("V2-1 (characterisation): max grants is guaranteed, the LOWEST discount among max-grant assignments is NOT - the shared syarat unit can be the cheapest reward unit", () => {
    // reviewer repro: D x1 @3500, A x6 @15000, B x4 @12500; syarat {D,A}>=1 AND {B,D}>=3 AND nilai>=5000; hasil any of D/A/B 80%.
    // D serves BOTH rows, so it is reserved as syarat (even though it is the cheapest reward unit); the brute-force minimum
    // would be 2800 (D discounted), the engine gives 10000 (B discounted). Grants (1) is right; the discount is still a valid reward discount.
    const def: SyaratHasilDef = {
      id: "v21", repeat: false,
      syarat: [{ kind: "qty", min: 1, items: [ref(D), ref(A)] }, { kind: "qty", min: 3, items: [ref(B), ref(D)] }, { kind: "nilai", min: 5000 }],
      hasil: { items: [ref(D), ref(A), ref(B)], discount: percent(80) },
    };
    const r = calc([line(0, D, 1, 3500), line(1, A, 6, 15000), line(2, B, 4, 12500)], [def]);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].grants).toBe(1);
    expect(r.discount_total).toBe(10000);
  });
  it("V2-3: STRICT rejects forced+excluded BEFORE it looks at lines or promos (the early throw is load-bearing)", () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof SyaratHasilError ? e.code : "raw:" + String(e); } return "no throw"; };
    const opt = { forced_promo_id: "p-bolt-anc", excluded_promo_ids: ["p-bolt-anc"] };
    // garbage line + duplicate promo ids would each throw a DIFFERENT typed error later; the option conflict must win
    expect(code(() => calculateSyaratHasil([line(1.5, ANC, 1, 1)], [boltAnc()], opt))).toBe("SH_FORCED_EXCLUDED");
    expect(code(() => calculateSyaratHasil([line(1, ANC, 1, 1)], [boltAnc(), boltAnc()], opt))).toBe("SH_FORCED_EXCLUDED");
    expect(code(() => calculateSyaratHasil([line(1, ANC, 1, 1)], [boltAnc({ syarat: [] })], opt))).toBe("SH_FORCED_EXCLUDED");
    // control: without the conflicting options the same inputs throw their own codes
    expect(code(() => calculateSyaratHasil([line(1.5, ANC, 1, 1)], [boltAnc()]))).toBe("SH_LINE_POSITION_INVALID");
    // SAFE never throws on the conflict
    expect(code(() => calc([line(1, ANC, 1, 1)], [boltAnc()], opt))).toBe("no throw");
  });
});
