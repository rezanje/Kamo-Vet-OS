import { describe, expect, it } from "vitest";
import {
  composeSyaratHasilCart,
  isSyaratHasilRule,
  syaratHasilDefFromRow,
  type LegacyHit,
  type ShRow,
} from "../promo-syarat-hasil-checkout";
import type { SyaratHasilDef } from "../promo-syarat-hasil";

const IKAN = "bolt-ikan", DONAT = "bolt-donat", ANC = "anc-creamy", KOPI = "kopi", JASA = "jasa-grooming";
const ref = (item_id: string) => ({ item_id, unit: "PCS" });
const row = (item_id: string, qty: number, harga: number, extra: Partial<ShRow> = {}): ShRow =>
  ({ item_id, nama: item_id, qty, harga, satuan: "PCS", faktor: 1, officialPrice: harga, item_type: "Persediaan", ...extra });

const boltAnc = (value = 1000, over: Partial<SyaratHasilDef> = {}): SyaratHasilDef => ({
  id: "sh-bolt-anc", name: "Beli 2 Bolt, ANC Creamy Stick -Rp1.000", repeat: true,
  syarat: [{ kind: "qty", min: 2, items: [ref(IKAN), ref(DONAT)] }],
  hasil: { items: [ref(ANC)], discount: { type: "nominal", value } },
  ...over,
});

/** Stand-in for hitungPromoKeranjang: the Bolt 2/6-style pool = 1000 off per Bolt unit on plain rows when at least 2 Bolt units are in the cart. */
const boltPool = (perUnit = 1000) => (rows: ShRow[]): LegacyHit[] => {
  const idx = rows.flatMap((r, i) => ((r.item_id === IKAN || r.item_id === DONAT) && !r.item_discount_value ? [i] : []));
  const units = idx.reduce((s, i) => s + rows[i].qty, 0);
  return units >= 2 ? idx.map((i) => ({ lineIndex: i, potongan: rows[i].qty * perUnit, promoId: "pool", promoName: "Bolt pool" })) : [];
};
const noLegacy = () => [] as LegacyHit[];

describe("isSyaratHasilRule / syaratHasilDefFromRow", () => {
  it("recognises the mode, nothing else", () => {
    expect(isSyaratHasilRule({ discount_mode: "syarat_hasil" })).toBe(true);
    for (const r of [null, undefined, {}, { discount_mode: "quantity_pool" }, { discount_mode: "per_unit" }, "syarat_hasil"]) expect(isSyaratHasilRule(r)).toBe(false);
  });
  const rule = (extra: Record<string, unknown> = {}) => ({
    discount_mode: "syarat_hasil", suggest: "x",
    syarat_hasil: {
      version: 1, repeat: true,
      syarat: [{ kind: "qty", min: 2, items: [ref(IKAN), ref(DONAT)] }, { kind: "nilai", min: 50000 }],
      hasil: { kind: "barang", items: [ref(ANC)], reward_qty: 2, discount: { type: "percent", value: 50, max_amount: 4000 } },
      below_hpp: { allowed: false }, ...extra,
    },
  });
  it("maps the stored rule to an engine definition (hasil.kind dropped, below_hpp -> allow_below_hpp only when released)", () => {
    const def = syaratHasilDefFromRow({ id: "p1", name: "Promo", rule: rule() }, { belowHppReleased: true });
    expect(def).toEqual({
      id: "p1", name: "Promo", repeat: true,
      syarat: [{ kind: "qty", min: 2, items: [ref(IKAN), ref(DONAT)] }, { kind: "nilai", min: 50000 }],
      hasil: { items: [ref(ANC)], reward_qty: 2, discount: { type: "percent", value: 50, max_amount: 4000 } },
      allow_below_hpp: false,
    });
    const waiver = rule({ below_hpp: { allowed: true, reason: "barang mendekati expired", ack_by: "u", ack_at: "t" } });
    expect(syaratHasilDefFromRow({ id: "p", name: "n", rule: waiver }, { belowHppReleased: true })?.allow_below_hpp).toBe(true);
    expect(syaratHasilDefFromRow({ id: "p", name: "n", rule: waiver }, { belowHppReleased: false })?.allow_below_hpp).toBe(false);
  });
  it("fails closed: a malformed definition gives null (the promo is skipped, never thrown)", () => {
    expect(syaratHasilDefFromRow({ id: "p", name: "n", rule: { discount_mode: "syarat_hasil" } }, { belowHppReleased: false })).toBeNull();
    expect(syaratHasilDefFromRow({ id: "p", name: "n", rule: rule({ syarat: [] }) }, { belowHppReleased: false })).toBeNull();
    expect(syaratHasilDefFromRow({ id: "p", name: "n", rule: { discount_mode: "per_unit" } }, { belowHppReleased: false })).toBeNull();
  });
});

describe("composeSyaratHasilCart", () => {
  it("no definitions: the legacy hits are mapped 1:1, rows unchanged (no-op)", () => {
    const rows = [row(IKAN, 2, 20000), row(ANC, 1, 15000)];
    const r = composeSyaratHasilCart({ rows, defs: [], legacy: boltPool() });
    expect(r.strategy).toBe("legacy");
    expect(r.rows.map((x) => [x.item_id, x.qty, x.promo_discount, x.promo_id, x.sh_claim ?? null])).toEqual([[IKAN, 2, 2000, "pool", null], [ANC, 1, 0, null, null]]);
    expect(r.rows.map((x) => x.origin_index)).toEqual([0, 1]);
  });

  it("Andri's example: Bolt Ikan x2 + ANC x1 -> ANC -Rp1.000, the syarat line carries no discount; claims carry the witness", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [boltAnc()], legacy: noLegacy });
    expect(r.strategy).toBe("syarat_hasil");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ item_id: IKAN, qty: 2, promo_discount: 0, promo_id: null, sh_claim: { promo_id: "sh-bolt-anc", sets: 1, syarat_units: 2, hasil_units: 0, waiver: false } });
    expect(r.rows[1]).toMatchObject({ item_id: ANC, qty: 1, promo_discount: 1000, promo_id: "sh-bolt-anc", sh_claim: { promo_id: "sh-bolt-anc", sets: 1, syarat_units: 0, hasil_units: 1, waiver: false } });
    expect(r.applied).toEqual([{ promo_id: "sh-bolt-anc", name: "Beli 2 Bolt, ANC Creamy Stick -Rp1.000", discount: 1000, kind: "syarat_hasil" }]);
    expect(r.savings).toMatchObject({ syarat_hasil: 1000, legacy: 0, total: 1000 });
  });

  it("splits a line into the claimed units and the plain remainder (Bolt x3 -> 2 syarat units + 1 plain; ANC x3 -> 1 reward + 2 plain)", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 3, 20000), row(ANC, 3, 15000)], defs: [boltAnc()], legacy: noLegacy });
    expect(r.rows.map((x) => [x.item_id, x.qty, x.promo_discount, x.sh_claim?.syarat_units ?? 0, x.sh_claim?.hasil_units ?? 0, x.origin_index])).toEqual([
      [IKAN, 2, 0, 2, 0, 0], [IKAN, 1, 0, 0, 0, 0], [ANC, 1, 1000, 0, 1, 1], [ANC, 2, 0, 0, 0, 1],
    ]);
    // quantities are preserved per origin line, money is preserved
    for (const origin of [0, 1]) expect(r.rows.filter((x) => x.origin_index === origin).reduce((s, x) => s + x.qty, 0)).toBe(origin === 0 ? 3 : 3);
  });

  it("kelipatan: Bolt x5 + ANC x2 -> 2 sets, 4 syarat units, 2 reward units", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 3, 20000), row(DONAT, 2, 20000), row(ANC, 2, 15000)], defs: [boltAnc()], legacy: noLegacy });
    expect(r.savings.syarat_hasil).toBe(2000);
    expect(r.rows.filter((x) => x.sh_claim).every((x) => x.sh_claim!.sets === 2)).toBe(true);
    expect(r.rows.reduce((s, x) => s + (x.sh_claim?.syarat_units ?? 0), 0)).toBe(4);
  });

  it("conflict with the Bolt pool: the promo that saves the customer MORE wins (pool 2000 > syarat-hasil 1000)", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [boltAnc(1000)], legacy: boltPool() });
    expect(r.strategy).toBe("legacy");
    expect(r.rows.map((x) => [x.item_id, x.qty, x.promo_discount, x.promo_id])).toEqual([[IKAN, 2, 2000, "pool"], [ANC, 1, 0, null]]);
    expect(r.savings.total).toBe(2000);
    // the promo that was not used is reported for the cashier
    expect(r.notApplied).toEqual([{ promo_id: "sh-bolt-anc", name: "Beli 2 Bolt, ANC Creamy Stick -Rp1.000", saving: 1000 }]);
  });
  it("conflict with the Bolt pool: syarat-hasil 3000 > pool 2000 wins, the claimed line leaves the pool", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [boltAnc(3000)], legacy: boltPool() });
    expect(r.strategy).toBe("syarat_hasil");
    expect(r.rows.map((x) => [x.item_id, x.qty, x.promo_discount, x.promo_id])).toEqual([[IKAN, 2, 0, null], [ANC, 1, 3000, "sh-bolt-anc"]]);
    expect(r.savings).toMatchObject({ total: 3000, legacy: 0, syarat_hasil: 3000 });
  });
  it("a tie keeps the existing (legacy) behaviour", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [boltAnc(2000)], legacy: boltPool() });
    expect(r.strategy).toBe("legacy");
    expect(r.savings.total).toBe(2000);
  });
  it("non-conflicting promos run together: the legacy promo keeps its untouched lines, the remainder of a split line is re-evaluated by the legacy engine", () => {
    // Bolt x4: 2 units are syarat units, the 2 leftover units form a NEW plain line that still earns the pool (2 Bolt units)
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 4, 20000), row(ANC, 1, 15000), row(KOPI, 1, 80000)], defs: [boltAnc(3000)], legacy: boltPool() });
    expect(r.strategy).toBe("syarat_hasil");
    expect(r.rows.map((x) => [x.item_id, x.qty, x.promo_discount, x.promo_id])).toEqual([
      [IKAN, 2, 0, null], [IKAN, 2, 2000, "pool"], [ANC, 1, 3000, "sh-bolt-anc"], [KOPI, 1, 0, null],
    ]);
    expect(r.savings).toMatchObject({ syarat_hasil: 3000, legacy: 2000, total: 5000 });
  });
  it("flags/picker off equivalent: mode 'tanpa' applies nothing (no legacy, no syarat-hasil)", () => {
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [boltAnc()], legacy: boltPool(), mode: "tanpa" });
    expect(r.strategy).toBe("none");
    expect(r.rows.every((x) => x.promo_discount === 0 && x.promo_id === null && !x.sh_claim)).toBe(true);
    expect(r.applied).toEqual([]);
  });

  it("only eligible lines take part: a tier-priced line, a manual-discount line, Jasa and free text do not become syarat or reward units", () => {
    const rows = [
      row(IKAN, 2, 18000, { officialPrice: 20000 }),               // tier price below the official price
      row(DONAT, 2, 20000, { item_discount_type: "nominal", item_discount_value: 500 }), // manual discount
      row(JASA, 2, 30000, { item_type: "Jasa" }),
      row("", 2, 20000, { item_type: "Non-Persediaan", officialPrice: undefined }),
      row(ANC, 1, 15000),
    ];
    const r = composeSyaratHasilCart({ rows, defs: [boltAnc()], legacy: noLegacy });
    expect(r.strategy).toBe("none");
    expect(r.rows).toHaveLength(5);
  });
  it("a Jasa line is never a syarat or reward unit even when its item sits in the pool (only Persediaan lines are claimable)", () => {
    const def = boltAnc(1000, { syarat: [{ kind: "qty", min: 2, items: [ref(JASA)] }] });
    const r = composeSyaratHasilCart({ rows: [row(JASA, 2, 30000, { item_type: "Jasa" }), row(ANC, 1, 15000)], defs: [def], legacy: noLegacy });
    expect(r.strategy).toBe("none");
    const reward = boltAnc(1000, { hasil: { items: [ref(JASA)], discount: { type: "nominal", value: 1000 } } });
    expect(composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(JASA, 1, 30000, { item_type: "Jasa" })], defs: [reward], legacy: noLegacy }).strategy).toBe("none");
  });
  it("nilai syarat counts the whole cart (incl. Jasa lines) but only lines that join a master; a reward-only cart does not qualify itself (R5)", () => {
    const nilai: SyaratHasilDef = { id: "sh-nilai", name: "Belanja 100rb", repeat: false, syarat: [{ kind: "nilai", min: 100000 }], hasil: { items: [ref(ANC)], discount: { type: "nominal", value: 1000 } } };
    const ok = composeSyaratHasilCart({ rows: [row(JASA, 1, 86000, { item_type: "Jasa" }), row(ANC, 1, 15000)], defs: [nilai], legacy: noLegacy });
    expect(ok.savings.syarat_hasil).toBe(1000); // 86000 + 14000 = exactly 100000
    const no = composeSyaratHasilCart({ rows: [row(JASA, 1, 85999, { item_type: "Jasa" }), row(ANC, 1, 15000)], defs: [nilai], legacy: noLegacy });
    expect(no.strategy).toBe("none");
    const only = composeSyaratHasilCart({ rows: [row(ANC, 1, 15000)], defs: [{ ...nilai, syarat: [{ kind: "nilai", min: 14500 }] }], legacy: noLegacy });
    expect(only.strategy).toBe("none");
  });
  it("the nilai syarat is verified against the FINAL charges: a legacy discount applied to the remaining lines must not push it below the threshold", () => {
    const nilai = (min: number): SyaratHasilDef => ({ id: "sh-nilai", name: "N", repeat: false, syarat: [{ kind: "nilai", min }], hasil: { items: [ref(ANC)], discount: { type: "nominal", value: 1000 } } });
    const perUnit3000 = (rows: ShRow[]): LegacyHit[] => rows.flatMap((r, i) => (r.item_id === KOPI ? [{ lineIndex: i, potongan: 3000, promoId: "kopi-promo", promoName: "Kopi" }] : []));
    const rows = [row(KOPI, 1, 90000), row(ANC, 1, 15000)];
    // 90000-3000 + (15000-1000) = 101000
    expect(composeSyaratHasilCart({ rows, defs: [nilai(101000)], legacy: perUnit3000 }).savings).toMatchObject({ legacy: 3000, syarat_hasil: 1000, total: 4000 });
    const tight = composeSyaratHasilCart({ rows, defs: [nilai(101001)], legacy: perUnit3000 });
    expect(tight.strategy).toBe("legacy"); // never a claim the database would refuse
    expect(tight.savings).toMatchObject({ legacy: 3000, syarat_hasil: 0 });
    expect(tight.rows.every((x) => !x.sh_claim)).toBe(true);
  });

  it("below-HPP waiver promos: a reward unit sharing its line with syarat units gets its own pure reward line carrying the waiver flag", () => {
    const def: SyaratHasilDef = { id: "sh-w", name: "Habiskan", repeat: false, allow_below_hpp: true, syarat: [{ kind: "qty", min: 1, items: [ref(ANC)] }], hasil: { items: [ref(ANC)], discount: { type: "nominal", value: 5000 } } };
    const r = composeSyaratHasilCart({ rows: [row(ANC, 2, 15000)], defs: [def], legacy: noLegacy });
    expect(r.rows.map((x) => [x.qty, x.promo_discount, x.sh_claim?.syarat_units ?? 0, x.sh_claim?.hasil_units ?? 0, x.sh_claim?.waiver ?? null])).toEqual([[1, 0, 1, 0, false], [1, 5000, 0, 1, true]]);
  });

  it("is a pure function: the input rows are untouched and the result is deterministic", () => {
    const rows = Object.freeze([Object.freeze(row(IKAN, 2, 20000)), Object.freeze(row(ANC, 1, 15000))]) as unknown as ShRow[];
    const a = composeSyaratHasilCart({ rows, defs: [boltAnc()], legacy: boltPool() });
    const b = composeSyaratHasilCart({ rows, defs: [boltAnc()], legacy: boltPool() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("a broken definition is skipped and reported, the others still apply", () => {
    const broken = { ...boltAnc(), id: "broken", syarat: [] } as SyaratHasilDef;
    const r = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [broken, boltAnc()], legacy: noLegacy });
    expect(r.strategy).toBe("syarat_hasil");
    expect(r.skipped.map((s) => s.promo_id)).toEqual(["broken"]);
  });
});
