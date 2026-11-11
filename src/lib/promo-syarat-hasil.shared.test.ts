import { describe, expect, it } from "vitest";
import { calculateSyaratHasil, calculateSyaratHasilSafe, type SyaratHasilCartLine, type SyaratHasilDef } from "./promo-syarat-hasil";
import { composeSyaratHasilCart, type LegacyHit, type ShRow } from "./promo-syarat-hasil-checkout";

/**
 * Andri 11 Nov 2026 (PayDay 11.11): "Harusnya cukup dikasih syarat, ada maksimal qty terdiskon, dan ada informasi berlaku kelipatan.
 * Jadi setiap 100k tidak bisa ditambah dengan item2 hadiah syarat yang lain."
 *
 * The `nilai` syarat is ONE shared pool of spend per receipt: every promo set that uses it consumes sets x min (largest nilai row of
 * the promo) of the money actually charged for the cart (after every reward discount, R5). A rupiah of spend cannot satisfy two promos.
 * Tie-break between competing rewards: the engine's existing best-of rule = the biggest saving for the customer wins
 * (ties: smaller promo id), independent of the order of the cart lines.
 */

const LITTER = "litter", DIATOMIX = "diatomix", KALUNG = "kalung", TONGKAT = "tongkat", PASIR = "pasir-blue", PASIR2 = "pasir-coffee", GUNTING = "gunting";
const ICARE = "icare-mbc", RECOVERY = "icare-recovery", SISIR = "sisir", DETICK = "detick", FILLER = "filler";
const ref = (item_id: string) => ({ item_id, unit: "PCS" });
const line = (pos: number, item_id: string, qty: number, unit_price: number): SyaratHasilCartLine => ({ source_position: pos, item_id, unit: "PCS", qty, unit_price, evidence_ok: true });

/** A live "PayDay 11.11" promo: "Belanja minimal Rp100.000 -> potongan Rp<value> per PCS <item>, berlaku kelipatan", below-HPP allowed. */
const payday = (id: string, items: string[], value: number, over: Partial<SyaratHasilDef> = {}): SyaratHasilDef => ({
  id, name: "PayDay 11.11", repeat: true, allow_below_hpp: true,
  syarat: [{ kind: "nilai", min: 100000 }],
  hasil: { items: items.map(ref), reward_qty: 1, discount: { type: "nominal", value } },
  ...over,
});
const LIVE: SyaratHasilDef[] = [
  payday("p-gunting", [GUNTING], 14000), payday("p-pasir", [PASIR, PASIR2], 19000), payday("p-icare", [ICARE], 29000), payday("p-detick", [DETICK], 19000),
  payday("p-recovery", [RECOVERY], 34000), payday("p-sisir", [SISIR], 9000), payday("p-tongkat", [TONGKAT], 14000),
];

/** Rows as the cart: item, qty, price. */
const cart = (rows: [string, number, number][]) => rows.map(([id, qty, price], i) => line(i, id, qty, price));
const cart155 = () => cart([[LITTER, 1, 30000], [DIATOMIX, 1, 25000], [KALUNG, 1, 20000], [TONGKAT, 1, 25000], [PASIR, 1, 30000], [GUNTING, 1, 25000]]);

/** Money the customer pays for the cart after the engine's reward discounts. */
const paid = (lines: SyaratHasilCartLine[], total: number) => lines.reduce((s, l) => s + l.qty * l.unit_price, 0) - total;
const consumed = (claims: { promo_id: string; sets_consumed: number }[], defs: SyaratHasilDef[]) =>
  claims.reduce((s, c) => {
    const d = defs.find((x) => x.id === c.promo_id) as SyaratHasilDef;
    const mins = d.syarat.flatMap((r) => (r.kind === "nilai" ? [r.min] : []));
    return s + (mins.length ? c.sets_consumed * Math.max(...mins) : 0);
  }, 0);

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }
function shuffled<T>(a: T[], r: () => number): T[] { const o = [...a]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }
function permutations<T>(a: T[]): T[][] { return a.length <= 1 ? [a] : a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])); }
const renumber = (rows: [string, number, number][]) => cart(rows);

describe("(1) the nilai syarat is ONE shared pool: Rp100.000 of spend buys ONE reward set", () => {
  it("THE reported receipt: 155.000 with 7 live PayDay promos -> exactly ONE reward (the biggest, Pasir Rp19.000), not Pasir+Gunting+Tongkat Rp47.000", () => {
    const r = calculateSyaratHasil(cart155(), LIVE);
    expect(r.discount_total).toBe(19000);
    expect(r.claims.map((c) => [c.promo_id, c.discount_total, c.sets_consumed])).toEqual([["p-pasir", 19000, 1]]);
    expect(r.lines.map((l) => l.discount)).toEqual([0, 0, 0, 0, 19000, 0]);
  });
  it("the same 155.000 through the safe (checkout) entry and with the greedy strategy", () => {
    expect(calculateSyaratHasilSafe(cart155(), LIVE).discount_total).toBe(19000);
    expect(calculateSyaratHasilSafe(cart155(), LIVE, { conflict_strategy: "greedy", alternatives: false }).discount_total).toBe(19000);
    expect(calculateSyaratHasilSafe(cart155(), LIVE, { one_promo_per_line: true, alternatives: false }).discount_total).toBe(19000);
  });
  it("split receipts agree: Rp30.000 -> nothing, Rp125.000 -> one Pasir reward (the real receipts of the day)", () => {
    expect(calculateSyaratHasil(cart([[LITTER, 1, 30000]]), LIVE).discount_total).toBe(0);
    const r = calculateSyaratHasil(cart([[DIATOMIX, 1, 25000], [KALUNG, 1, 20000], [TONGKAT, 1, 25000], [PASIR, 1, 30000], [GUNTING, 1, 25000]]), LIVE);
    expect(r.discount_total).toBe(19000);
  });
  it("order of the cart lines never changes the total or the chosen reward (all 720 orders of the 155.000 cart)", () => {
    const rows: [string, number, number][] = [[LITTER, 1, 30000], [DIATOMIX, 1, 25000], [KALUNG, 1, 20000], [TONGKAT, 1, 25000], [PASIR, 1, 30000], [GUNTING, 1, 25000]];
    for (const p of permutations(rows)) {
      const r = calculateSyaratHasil(renumber(p), LIVE);
      expect(r.discount_total).toBe(19000);
      expect(r.claims.map((c) => c.promo_id)).toEqual(["p-pasir"]);
    }
  });
  it("the order of the promo definitions never changes the result either", () => {
    for (const defs of [[...LIVE].reverse(), shuffled(LIVE, rng(7)), shuffled(LIVE, rng(11))]) {
      const r = calculateSyaratHasil(cart155(), defs);
      expect(r.discount_total).toBe(19000);
      expect(r.claims.map((c) => c.promo_id)).toEqual(["p-pasir"]);
    }
  });
  it("Rp250.000 buys TWO sets: the two biggest rewards (Pasir 19.000 + Gunting 14.000, tie Gunting/Tongkat -> smaller id), the third would need Rp300.000", () => {
    const c = cart([[FILLER, 1, 170000], [TONGKAT, 1, 25000], [PASIR, 1, 30000], [GUNTING, 1, 25000]]);
    const r = calculateSyaratHasil(c, LIVE);
    expect(r.discount_total).toBe(33000);
    expect(r.claims.map((x) => x.promo_id).sort()).toEqual(["p-gunting", "p-pasir"]);
    expect(consumed(r.claims, LIVE)).toBe(200000);
    expect(paid(c, r.discount_total)).toBeGreaterThanOrEqual(200000);
  });
  it("two sets need the real money: 233.000 (paid exactly 200.000 after 33.000) buys the 33.000 pair; one rupiah less the best AFFORDABLE pair is Gunting+Tongkat 28.000", () => {
    const mk = (filler: number) => cart([[FILLER, 1, filler], [PASIR, 1, 30000], [GUNTING, 1, 25000], [TONGKAT, 1, 25000]]);
    expect(calculateSyaratHasil(mk(153000), LIVE).discount_total).toBe(33000);
    const r = calculateSyaratHasil(mk(152999), LIVE); // Pasir+Gunting would leave 199.999 < 200.000; Gunting+Tongkat leaves 204.999
    expect(r.discount_total).toBe(28000);
    expect(r.claims.map((c) => c.promo_id).sort()).toEqual(["p-gunting", "p-tongkat"]);
  });
  it("order independence on random carts and the invariant sum(sets x min) <= money paid (500 random carts)", () => {
    const r = rng(20261111);
    const items: [string, number][] = [[LITTER, 30000], [DIATOMIX, 25000], [KALUNG, 20000], [TONGKAT, 25000], [PASIR, 30000], [PASIR2, 31000], [GUNTING, 25000], [ICARE, 70000], [RECOVERY, 90000], [SISIR, 15000], [DETICK, 28000], [FILLER, 10000]];
    for (let n = 0; n < 500; n++) {
      const rows: [string, number, number][] = items.filter(() => r() < 0.5).map(([id, p]) => [id, 1 + Math.floor(r() * 3), p]);
      if (rows.length === 0) continue;
      const a = calculateSyaratHasil(renumber(rows), LIVE);
      const b = calculateSyaratHasil(renumber(shuffled(rows, r)), LIVE);
      expect(b.discount_total, JSON.stringify(rows)).toBe(a.discount_total);
      expect(consumed(a.claims, LIVE), JSON.stringify(rows)).toBeLessThanOrEqual(paid(renumber(rows), a.discount_total));
    }
  });
  it("two promos with DIFFERENT thresholds still share the money: Rp100.000 + Rp50.000 need Rp150.000 paid", () => {
    const a = payday("A", [PASIR], 10000), b = payday("B", [GUNTING], 5000, { syarat: [{ kind: "nilai", min: 50000 }] });
    // 175.000 - 15.000 = 160.000 >= 150.000 -> both
    expect(calculateSyaratHasil(cart([[FILLER, 1, 120000], [PASIR, 1, 30000], [GUNTING, 1, 25000]]), [a, b]).discount_total).toBe(15000);
    // 164.000 - 15.000 = 149.000 < 150.000 -> only one of them (the bigger one)
    const one = calculateSyaratHasil(cart([[FILLER, 1, 109000], [PASIR, 1, 30000], [GUNTING, 1, 25000]]), [a, b]);
    expect(one.discount_total).toBe(10000);
    expect(one.claims).toHaveLength(1);
  });
  it("one promo with two nilai rows (>=100.000 AND >=200.000) is bought by the LARGEST: one set per 200.000 and it shares that money", () => {
    const strict = payday("S", [PASIR], 19000, { syarat: [{ kind: "nilai", min: 100000 }, { kind: "nilai", min: 200000 }] });
    const other = payday("O", [GUNTING], 14000);
    // paid 231.000 after 19.000: S takes 200.000 -> 31.000 left, O (needs 100.000) cannot join
    const r = calculateSyaratHasil(cart([[FILLER, 1, 195000], [PASIR, 1, 30000], [GUNTING, 1, 25000]]), [strict, other]);
    expect(r.discount_total).toBe(19000);
    expect(r.claims).toHaveLength(1);
    expect(consumed(r.claims, [strict, other])).toBe(200000);
  });
  it("the cashier can still force or exclude a promo; the forced one claims the shared money first", () => {
    const f = calculateSyaratHasil(cart155(), LIVE, { forced_promo_id: "p-gunting" });
    expect(f.discount_total).toBe(14000);
    expect(f.claims.map((c) => c.promo_id)).toEqual(["p-gunting"]);
    const x = calculateSyaratHasil(cart155(), LIVE, { excluded_promo_ids: ["p-pasir"] });
    expect(x.discount_total).toBe(14000);
    expect(x.claims).toHaveLength(1);
  });
});

describe("(1b) brute-force oracle: the engine never grants more than the money allows, and reaches the best set almost always", () => {
  it("3000 random carts of single-reward nilai promos (same or mixed thresholds): never above the optimum, within 1% of carts below it", () => {
    const r = rng(99);
    let below = 0;
    const N = 3000;
    for (let t = 0; t < N; t++) {
      const k = 2 + Math.floor(r() * 5);
      const items = Array.from({ length: k }, (_, i) => ({ id: "i" + i, price: 10000 + Math.floor(r() * 9) * 5000, d: 1000 * (1 + Math.floor(r() * 30)), min: r() < 0.6 ? 100000 : 50000 * (1 + Math.floor(r() * 3)) }));
      const filler = Math.floor(r() * 40) * 10000;
      const defs: SyaratHasilDef[] = items.map((x, i) => ({ id: "p" + String(i).padStart(2, "0"), repeat: false, syarat: [{ kind: "nilai", min: x.min }], hasil: { items: [ref(x.id)], discount: { type: "nominal", value: x.d } } }));
      const c = [...items.map((x, i) => line(i, x.id, 1, x.price)), ...(filler ? [line(k, FILLER, 1, filler)] : [])];
      const sub = items.reduce((s, x) => s + x.price, 0) + filler;
      const dsc = items.map((x) => Math.min(x.d, x.price - 1));
      let best = 0;
      for (let m = 1; m < 1 << k; m++) {
        let need = 0, d = 0;
        for (let i = 0; i < k; i++) if ((m >> i) & 1) { need += items[i].min; d += dsc[i]; }
        if (need <= sub - d && d > best) best = d;
      }
      const got = calculateSyaratHasil(c, defs).discount_total;
      expect(got, JSON.stringify({ items, filler })).toBeLessThanOrEqual(best);
      if (got < best) below++;
    }
    expect(below / N).toBeLessThan(0.01); // best_of is documented as NOT a global optimum (header G1); measured ~0.4% on this adversarial mix
  });
});

describe("(2) the reward discount lands ONLY on the reward quantity, never on the other units of the same item", () => {
  it("2 x Pasir (the second is the reward): one unit discounted, the other full price", () => {
    const c = cart([[FILLER, 1, 80000], [PASIR, 2, 30000]]);
    const r = calculateSyaratHasil(c, LIVE);
    expect(r.discount_total).toBe(19000);
    const l = r.lines.find((x) => x.item_id === PASIR);
    expect(l?.discount).toBe(19000);
    expect(l?.claims).toMatchObject([{ hasil_units: 1, discount_per_unit: 19000, discount: 19000 }]);
    expect(l?.net).toBe(60000 - 19000);
  });
  it("max qty: reward_qty 1 per set, 5 units of the item in a Rp100.000 cart -> still ONE discounted unit; reward_qty 2 -> two", () => {
    const one = calculateSyaratHasil(cart([[PASIR, 5, 30000]]), [payday("p", [PASIR], 19000)]); // 150.000 - 19.000 = 131.000: one set
    expect(one.discount_total).toBe(19000);
    expect(one.lines[0].claims[0].hasil_units).toBe(1);
    const two = calculateSyaratHasil(cart([[PASIR, 5, 30000]]), [payday("p", [PASIR], 19000, { hasil: { items: [ref(PASIR)], reward_qty: 2, discount: { type: "nominal", value: 19000 } } })]);
    expect(two.discount_total).toBe(38000); // 150.000 - 38.000 = 112.000 >= 100.000
    expect(two.lines[0].claims[0].hasil_units).toBe(2);
  });
  it("without repeat only ONE set however much is bought, with repeat the sets follow floor(paid / min)", () => {
    const base = cart([[FILLER, 1, 300000], [PASIR, 5, 30000]]); // 450.000
    expect(calculateSyaratHasil(base, [payday("p", [PASIR], 19000, { repeat: false })]).discount_total).toBe(19000);
    const rep = calculateSyaratHasil(base, [payday("p", [PASIR], 19000)]);
    expect(rep.claims[0].sets_consumed).toBe(3); // 3 sets: 450.000 - 57.000 = 393.000 >= 300.000; 4 sets: 374.000 < 400.000
    expect(rep.discount_total).toBe(57000);
  });
});

describe("(3) kelipatan: sets = floor(available paid spend / min), bounded by the reward quantity", () => {
  const only = (over: Partial<SyaratHasilDef> = {}) => [payday("p", [PASIR], 19000, over)];
  const r4 = (c: SyaratHasilCartLine[], defs: SyaratHasilDef[]) => calculateSyaratHasil(c, defs);
  it("the sets follow the money PAID after the rewards: 300.000 with 5 Pasir -> 2 sets (3 sets would need 300.000 of paid money, only 243.000)", () => {
    const r = r4(cart([[FILLER, 1, 150000], [PASIR, 5, 30000]]), only());
    expect(r.claims[0].sets_consumed).toBe(2);
    expect(r.discount_total).toBe(38000);
  });
  it("the sets are bounded by the reward units in the cart: Rp930.000 but ONE Pasir -> one set, one discounted unit", () => {
    const r = r4(cart([[FILLER, 1, 900000], [PASIR, 1, 30000]]), only());
    expect(r.claims[0].sets_consumed).toBe(1);
    expect(r.discount_total).toBe(19000);
  });
  it("max qty per set (reward_qty 2): Rp1.050.000 with 5 Pasir -> 3 sets, 5 discounted units (never more than the units in the cart)", () => {
    const r = r4(cart([[FILLER, 1, 900000], [PASIR, 5, 30000]]), only({ hasil: { items: [ref(PASIR)], reward_qty: 2, discount: { type: "nominal", value: 19000 } } }));
    expect(r.claims[0].sets_consumed).toBe(3);
    expect(r.lines.find((l) => l.item_id === PASIR)?.claims[0].hasil_units).toBe(5);
    expect(r.discount_total).toBe(95000);
  });
  it("without repeat: ONE set however much is bought", () => {
    expect(r4(cart([[FILLER, 1, 300000], [PASIR, 5, 30000]]), only({ repeat: false })).discount_total).toBe(19000);
  });
  it("boundary: the second set is granted at exactly 200.000 paid and refused one rupiah below", () => {
    const d = only();
    const at = (filler: number) => r4(cart([[FILLER, 1, filler], [PASIR, 2, 30000]]), d).discount_total;
    expect(at(178000)).toBe(38000); // 238.000 - 38.000 = 200.000
    expect(at(177999)).toBe(19000);
  });
});

describe("(4) qty syarat: unchanged behaviour, and it consumes no shared spend", () => {
  const qtyPromo = (id: string, buy: string, get: string, value: number, over: Partial<SyaratHasilDef> = {}): SyaratHasilDef => ({
    id, repeat: true, syarat: [{ kind: "qty", min: 2, items: [ref(buy)] }], hasil: { items: [ref(get)], discount: { type: "nominal", value } }, ...over,
  });
  it("a qty promo and a nilai promo on disjoint units both apply: qty rows reserve units, they consume no money", () => {
    const defs = [qtyPromo("q", GUNTING, TONGKAT, 5000), payday("n", [PASIR], 19000)];
    const r = calculateSyaratHasil(cart([[GUNTING, 2, 25000], [TONGKAT, 1, 25000], [PASIR, 1, 30000], [FILLER, 1, 30000]]), defs); // 135.000: 130.000 after the qty reward, 111.000 after both
    expect(r.discount_total).toBe(5000 + 19000);
    expect(r.claims.map((c) => c.promo_id).sort()).toEqual(["n", "q"]);
  });
  it("a unit that is a reward unit does not count toward its own qty syarat (buy 2 of A, get A): 2 units -> nothing, 3 -> 1 set, 6 -> 2 sets", () => {
    const d = [qtyPromo("a", PASIR, PASIR, 10000)];
    expect(calculateSyaratHasil(cart([[PASIR, 2, 30000]]), d).discount_total).toBe(0);
    const three = calculateSyaratHasil(cart([[PASIR, 3, 30000]]), d);
    expect(three.discount_total).toBe(10000);
    expect(three.claims[0].syarat_units).toEqual([{ source_position: 0, units: 2 }]);
    expect(calculateSyaratHasil(cart([[PASIR, 4, 30000]]), d).discount_total).toBe(10000); // 2 syarat + 1 reward, 1 unit left over
    expect(calculateSyaratHasil(cart([[PASIR, 6, 30000]]), d).discount_total).toBe(20000);
  });
  it("qty + nilai in ONE promo: the nilai row consumes shared spend, the qty row units; another nilai promo only gets what is left", () => {
    const both = payday("both", [PASIR], 19000, { syarat: [{ kind: "qty", min: 2, items: [ref(GUNTING)] }, { kind: "nilai", min: 100000 }] });
    const other = payday("other", [TONGKAT], 14000);
    const r = calculateSyaratHasil(cart([[FILLER, 1, 90000], [GUNTING, 2, 25000], [PASIR, 1, 30000], [TONGKAT, 1, 25000]]), [both, other]); // 195.000
    expect(r.discount_total).toBe(19000); // 195.000 - 19.000 = 176.000: only ONE Rp100.000 is bought
    expect(r.claims.map((c) => c.promo_id)).toEqual(["both"]);
  });
  it("two qty-only promos are not limited by money at all", () => {
    const defs = [qtyPromo("q1", GUNTING, TONGKAT, 5000), qtyPromo("q2", KALUNG, PASIR, 4000)];
    const r = calculateSyaratHasil(cart([[GUNTING, 2, 1000], [TONGKAT, 1, 25000], [KALUNG, 2, 1000], [PASIR, 1, 30000]]), defs);
    expect(r.discount_total).toBe(9000);
  });
});

describe("(5) below-HPP and floor rules are not touched by the shared spend", () => {
  it("the engine still reports the waiver flag per claim/line and keeps net >= 1 per reward unit", () => {
    const r = calculateSyaratHasil(cart([[FILLER, 1, 110000], [RECOVERY, 1, 20000]]), [payday("w", [RECOVERY], 34000)]);
    expect(r.claims[0].below_hpp_waiver).toBe(true);
    expect(r.lines[1].discount).toBe(19999); // price - 1
    const plain = calculateSyaratHasil(cart([[FILLER, 1, 110000], [RECOVERY, 1, 20000]]), [payday("w", [RECOVERY], 34000, { allow_below_hpp: false })]);
    expect(plain.claims[0].below_hpp_waiver).toBe(false);
  });
});

describe("(6) the checkout composer: one reward per Rp100.000, discount only on the reward units", () => {
  const row = (item_id: string, qty: number, harga: number, extra: Partial<ShRow> = {}): ShRow =>
    ({ item_id, nama: item_id, qty, harga, satuan: "PCS", faktor: 1, officialPrice: harga, item_type: "Persediaan", ...extra });
  const noLegacy = () => [] as LegacyHit[];
  it("155.000 receipt: ONE PayDay claim, the other lines carry no promo", () => {
    const rows = [row(LITTER, 1, 30000), row(DIATOMIX, 1, 25000), row(KALUNG, 1, 20000), row(TONGKAT, 1, 25000), row(PASIR, 1, 30000), row(GUNTING, 1, 25000)];
    const r = composeSyaratHasilCart({ rows, defs: LIVE, legacy: noLegacy });
    expect(r.strategy).toBe("syarat_hasil");
    expect(r.applied).toHaveLength(1);
    expect(r.savings.total).toBe(19000);
    expect(r.rows.map((x) => x.promo_discount)).toEqual([0, 0, 0, 0, 19000, 0]);
    expect(r.rows.filter((x) => x.sh_claim).map((x) => [x.item_id, x.sh_claim?.hasil_units])).toEqual([[PASIR, 1]]);
  });
  it("2 x Pasir (one is the reward): the line splits into ONE discounted unit and ONE plain unit", () => {
    const r = composeSyaratHasilCart({ rows: [row(FILLER, 1, 80000), row(PASIR, 2, 30000)], defs: LIVE, legacy: noLegacy });
    const pasir = r.rows.filter((x) => x.item_id === PASIR);
    expect(pasir.map((x) => [x.qty, x.promo_discount])).toEqual([[1, 19000], [1, 0]]);
    expect(r.savings.total).toBe(19000);
  });
  it("250.000 receipt: two claims", () => {
    const rows = [row(FILLER, 1, 170000), row(TONGKAT, 1, 25000), row(PASIR, 1, 30000), row(GUNTING, 1, 25000)];
    const r = composeSyaratHasilCart({ rows, defs: LIVE, legacy: noLegacy });
    expect(r.applied).toHaveLength(2);
    expect(r.savings.total).toBe(33000);
  });
  /** money charged on the final rows vs the spend all claimed sets consume (sets x largest nilai row per promo) */
  const pool = (r: ReturnType<typeof composeSyaratHasilCart>, defs: SyaratHasilDef[]) => {
    const money = r.rows.reduce((s, x) => s + x.qty * x.harga - x.promo_discount, 0);
    const sets = new Map<string, number>();
    for (const x of r.rows) if (x.sh_claim) sets.set(x.sh_claim.promo_id, x.sh_claim.sets);
    let need = 0;
    for (const [id, n] of sets) {
      const d = defs.find((y) => y.id === id) as SyaratHasilDef;
      const mins = d.syarat.flatMap((q) => (q.kind === "nilai" ? [q.min] : []));
      if (mins.length) need += n * Math.max(...mins);
    }
    return { money, need, claims: sets.size };
  };
  const cutFiller = (v: number) => (rows: ShRow[]): LegacyHit[] => rows.flatMap((x, i) => (x.item_id === FILLER ? [{ lineIndex: i, potongan: v, promoId: "leg", promoName: "Legacy" }] : []));

  it("a legacy discount on the plain lines lowers the money paid: the shared spend is checked on the FINAL charges (syarat-hasil first, legacy on what is left)", () => {
    // 250.000: two rewards (33.000) leave 217.000, but a legacy discount of 25.000 on the filler leaves 192.000 < 200.000 -> that candidate is refused
    const rows = [row(FILLER, 1, 170000), row(TONGKAT, 1, 25000), row(PASIR, 1, 30000), row(GUNTING, 1, 25000)];
    const r = composeSyaratHasilCart({ rows, defs: LIVE, legacy: cutFiller(25000) });
    const p = pool(r, LIVE);
    expect(p.need).toBeLessThanOrEqual(p.money);
    expect(p.claims).toBe(1);
    expect(r.savings.total).toBe(25000 + 19000); // legacy 25.000 + the ONE reward the remaining money buys
  });
  it("the aggregate counts SETS: one promo with 2 sets + another with 1 set need Rp300.000 after the legacy discount (not 200.000)", () => {
    const defs = [payday("p-pasir", [PASIR], 19000), payday("p-gunting", [GUNTING], 14000)];
    const rows = [row(FILLER, 1, 267000), row(PASIR, 2, 30000), row(GUNTING, 1, 25000)]; // 352.000: 3 sets bought exactly (paid 300.000) without legacy
    expect(pool(composeSyaratHasilCart({ rows, defs, legacy: noLegacy }), defs)).toMatchObject({ need: 300000, money: 300000 });
    const r = composeSyaratHasilCart({ rows, defs, legacy: cutFiller(10000) }); // legacy leaves 290.000 -> three sets are no longer affordable
    const p = pool(r, defs);
    expect(p.need).toBeLessThanOrEqual(p.money);
  });
  it("the aggregate uses the LARGEST nilai row of a promo (100.000 + 200.000 rows) next to another promo", () => {
    const strict = payday("S", [PASIR], 19000, { syarat: [{ kind: "nilai", min: 100000 }, { kind: "nilai", min: 200000 }] });
    const other = payday("O", [GUNTING], 14000);
    const defs = [strict, other];
    const rows = [row(FILLER, 1, 278000), row(PASIR, 1, 30000), row(GUNTING, 1, 25000)]; // 333.000 - 33.000 = 300.000 = 200.000 + 100.000
    expect(pool(composeSyaratHasilCart({ rows, defs, legacy: noLegacy }), defs)).toMatchObject({ need: 300000, money: 300000, claims: 2 });
    const p = pool(composeSyaratHasilCart({ rows, defs, legacy: cutFiller(15000) }), defs); // 285.000 < 300.000
    expect(p.need).toBeLessThanOrEqual(p.money);
  });
  it("200 random carts with a random legacy discount: the claimed sets never need more than the money finally charged", () => {
    const r = rng(4242);
    const items: [string, number][] = [[LITTER, 30000], [TONGKAT, 25000], [PASIR, 30000], [GUNTING, 25000], [ICARE, 70000], [RECOVERY, 90000], [SISIR, 15000], [DETICK, 28000]];
    for (let n = 0; n < 200; n++) {
      const rows = items.filter(() => r() < 0.5).map(([id, p]) => row(id, 1 + Math.floor(r() * 2), p));
      const filler = Math.floor(r() * 40) * 10000;
      if (filler) rows.push(row(FILLER, 1, filler));
      if (rows.length === 0) continue;
      const cut = filler ? Math.floor(r() * (filler / 5000)) * 5000 : 0;
      const res = composeSyaratHasilCart({ rows, defs: LIVE, legacy: cutFiller(cut) });
      const p = pool(res, LIVE);
      expect(p.need, JSON.stringify({ rows: rows.map((x) => [x.item_id, x.qty, x.harga]), cut })).toBeLessThanOrEqual(p.money);
    }
  });
});
