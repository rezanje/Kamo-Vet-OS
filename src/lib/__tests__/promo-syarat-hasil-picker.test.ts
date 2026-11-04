import { describe, expect, it } from "vitest";
import {
  composeHppSafe,
  composeSyaratHasilCart,
  hppFindingsForClaims,
  type LegacyHit,
  type ShRow,
} from "../promo-syarat-hasil-checkout";
import type { SyaratHasilDef } from "../promo-syarat-hasil";

// Stage 3b: cashier picker (pilih / tanpa / alternatives), HPP guard (drop a promo whose reward sells below cost), min_sell_qty merge,
// fractional qty exactness, voucher-gate parity (hitCount).
const IKAN = "bolt-ikan", DONAT = "bolt-donat", ANC = "anc-creamy", KOPI = "kopi";
const ref = (item_id: string) => ({ item_id, unit: "PCS" });
const row = (item_id: string, qty: number, harga: number, extra: Partial<ShRow> = {}): ShRow =>
  ({ item_id, nama: item_id, qty, harga, satuan: "PCS", faktor: 1, officialPrice: harga, item_type: "Persediaan", ...extra });

const boltAnc = (value = 1000, over: Partial<SyaratHasilDef> = {}): SyaratHasilDef => ({
  id: "sh-bolt-anc", name: "Beli 2 Bolt, ANC -Rp1.000", repeat: true,
  syarat: [{ kind: "qty", min: 2, items: [ref(IKAN), ref(DONAT)] }],
  hasil: { items: [ref(ANC)], discount: { type: "nominal", value } },
  ...over,
});
const kopiAnc = (value = 500): SyaratHasilDef => ({
  id: "sh-kopi-anc", name: "Beli Kopi, ANC -Rp500", repeat: true,
  syarat: [{ kind: "qty", min: 1, items: [ref(KOPI)] }],
  hasil: { items: [ref(ANC)], discount: { type: "nominal", value } },
});
/** Legacy stand-in: pool "pool" = 1000 off per Bolt unit with >= 2 Bolt units; `only` restricts to one promo id. */
const legacy = (perUnit = 1000, zeroHit = false) => (rows: ShRow[], only?: string): LegacyHit[] => {
  if (only !== undefined && only !== "pool") return [];
  const idx = rows.flatMap((r, i) => ((r.item_id === IKAN || r.item_id === DONAT) && !r.item_discount_value ? [i] : []));
  const units = idx.reduce((s, i) => s + rows[i].qty, 0);
  if (zeroHit) return idx.length ? [{ lineIndex: idx[0], potongan: 0, promoId: "pool", promoName: "Bolt pool" }] : [];
  return units >= 2 ? idx.map((i) => ({ lineIndex: i, potongan: rows[i].qty * perUnit, promoId: "pool", promoName: "Bolt pool" })) : [];
};
const shape = (c: { rows: { item_id: string; qty: number; promo_discount: number; promo_id: string | null }[] }) => c.rows.map((r) => [r.item_id, r.qty, r.promo_discount, r.promo_id]);

describe("picker: auto / tanpa / pilih", () => {
  const cart = () => [row(IKAN, 2, 20000), row(ANC, 1, 15000)];
  it("auto: the pool (2000) beats syarat-hasil (1000); pick state is auto/ok", () => {
    const c = composeSyaratHasilCart({ rows: cart(), defs: [boltAnc()], legacy: legacy() });
    expect(c.strategy).toBe("legacy");
    expect(c.pick).toEqual({ mode: "auto", promo_id: null, ok: true });
    expect(c.hitCount).toBe(1);
  });
  it("pilih the syarat-hasil promo: it wins although it saves less, the pool is NOT applied (exclusive pick), claims are written", () => {
    const c = composeSyaratHasilCart({ rows: cart(), defs: [boltAnc()], legacy: legacy(), mode: "pilih", pickId: "sh-bolt-anc" });
    expect(c.pick).toEqual({ mode: "pilih", promo_id: "sh-bolt-anc", ok: true });
    expect(c.strategy).toBe("syarat_hasil");
    expect(shape(c)).toEqual([[IKAN, 2, 0, null], [ANC, 1, 1000, "sh-bolt-anc"]]);
    expect(c.rows.map((r) => r.sh_claim?.promo_id)).toEqual(["sh-bolt-anc", "sh-bolt-anc"]);
    expect(c.hitCount).toBe(1);
  });
  it("pilih a legacy promo (the pool) when syarat-hasil would save more: only the pool applies, nothing is claimed", () => {
    const c = composeSyaratHasilCart({ rows: cart(), defs: [boltAnc(5000)], legacy: legacy(), mode: "pilih", pickId: "pool", legacyPromos: [{ id: "pool", name: "Bolt pool" }] });
    expect(c.pick.ok).toBe(true);
    expect(c.strategy).toBe("legacy");
    expect(shape(c)).toEqual([[IKAN, 2, 2000, "pool"], [ANC, 1, 0, null]]);
    expect(c.rows.some((r) => r.sh_claim)).toBe(false);
  });
  it("pilih exclusive: another syarat-hasil promo and the legacy promos are off", () => {
    const rows = [row(IKAN, 2, 20000), row(KOPI, 1, 30000), row(ANC, 2, 15000)];
    const c = composeSyaratHasilCart({ rows, defs: [boltAnc(), kopiAnc()], legacy: legacy(), mode: "pilih", pickId: "sh-kopi-anc" });
    expect(c.pick.ok).toBe(true);
    expect(c.applied.map((a) => a.promo_id)).toEqual(["sh-kopi-anc"]);
    expect(c.rows.every((r) => r.promo_id === null || r.promo_id === "sh-kopi-anc")).toBe(true);
  });
  it("pilih is exclusive also against a NON-conflicting syarat-hasil promo (disjoint lines): auto applies both, the pick applies only the chosen one", () => {
    const kopiSnack: SyaratHasilDef = { id: "sh-kopi-snack", name: "Beli Kopi, Snack -Rp300", repeat: true, syarat: [{ kind: "qty", min: 1, items: [ref(KOPI)] }], hasil: { items: [ref("snack")], discount: { type: "nominal", value: 300 } } };
    const rows = [row(IKAN, 2, 20000), row(ANC, 1, 15000), row(KOPI, 1, 30000), row("snack", 1, 5000)];
    const auto = composeSyaratHasilCart({ rows, defs: [boltAnc(), kopiSnack], legacy: () => [] });
    expect(auto.applied.map((a) => a.promo_id).sort()).toEqual(["sh-bolt-anc", "sh-kopi-snack"]);
    const picked = composeSyaratHasilCart({ rows, defs: [boltAnc(), kopiSnack], legacy: () => [], mode: "pilih", pickId: "sh-bolt-anc" });
    expect(picked.applied.map((a) => a.promo_id)).toEqual(["sh-bolt-anc"]);
    expect(picked.rows.some((r) => r.sh_claim?.promo_id === "sh-kopi-snack")).toBe(false);
  });
  it("pilih a promo that does not apply to this cart (or an unknown id): pick.ok=false, nothing discounted (caller must refuse)", () => {
    const noAnc = [row(IKAN, 2, 20000)];
    for (const pickId of ["sh-bolt-anc", "does-not-exist"]) {
      const c = composeSyaratHasilCart({ rows: noAnc, defs: [boltAnc()], legacy: legacy(), mode: "pilih", pickId });
      expect(c.pick).toEqual({ mode: "pilih", promo_id: pickId, ok: false });
      expect(c.rows.every((r) => r.promo_discount === 0 && !r.sh_claim)).toBe(true);
      expect(c.hitCount).toBe(0);
    }
    const none = composeSyaratHasilCart({ rows: noAnc, defs: [boltAnc()], legacy: legacy(), mode: "pilih" });
    expect(none.pick.ok).toBe(false);
  });
  it("tanpa: no promo at all (legacy included), hitCount 0, pick ok", () => {
    const c = composeSyaratHasilCart({ rows: cart(), defs: [boltAnc()], legacy: legacy(), mode: "tanpa" });
    expect(c.pick).toEqual({ mode: "tanpa", promo_id: null, ok: true });
    expect(c.rows.every((r) => r.promo_discount === 0)).toBe(true);
    expect(c.hitCount).toBe(0);
  });
  it("alternatives list every promo that would save something when made main, with its saving and whether it is applied", () => {
    const c = composeSyaratHasilCart({ rows: cart(), defs: [boltAnc(), kopiAnc()], legacy: legacy(), legacyPromos: [{ id: "pool", name: "Bolt pool" }], withAlternatives: true });
    expect(c.alternatives).toEqual([
      { promo_id: "sh-bolt-anc", name: "Beli 2 Bolt, ANC -Rp1.000", kind: "syarat_hasil", saving: 1000, applied: false },
      { promo_id: "pool", name: "Bolt pool", kind: "legacy", saving: 2000, applied: true },
    ]);
    expect(composeSyaratHasilCart({ rows: cart(), defs: [boltAnc()], legacy: legacy() }).alternatives).toEqual([]);
  });
  it("excludedIds drop a syarat-hasil promo before planning (HPP guard) and are echoed", () => {
    const c = composeSyaratHasilCart({ rows: cart(), defs: [boltAnc(5000)], legacy: legacy(0), excludedIds: ["sh-bolt-anc"] });
    expect(c.strategy).toBe("none");
    expect(c.excluded).toEqual(["sh-bolt-anc"]);
  });
});

describe("voucher gate parity (hitCount)", () => {
  it("a legacy hit with potongan 0 still counts as an automatic promo, exactly like the non-composed path; composed claim counts once", () => {
    const rows = [row(IKAN, 1, 20000)];
    expect(composeSyaratHasilCart({ rows, defs: [boltAnc()], legacy: legacy(1000, true) }).hitCount).toBe(legacy(1000, true)(rows).length);
    const claimed = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 1, 15000)], defs: [boltAnc(5000)], legacy: legacy() });
    expect(claimed.strategy).toBe("syarat_hasil");
    expect(claimed.hitCount).toBe(1);
  });
});

describe("min_sell_qty: a split never leaves a part below the item minimum", () => {
  it("the plain remainder below the minimum is merged back into the claimed line (Bolt x3, min 3, 2 syarat units)", () => {
    const c = composeSyaratHasilCart({ rows: [row(IKAN, 3, 20000, { minSellBase: 3 }), row(ANC, 1, 15000)], defs: [boltAnc()], legacy: () => [] });
    expect(c.strategy).toBe("syarat_hasil");
    expect(c.rows.map((r) => [r.item_id, r.qty, r.sh_claim?.syarat_units, r.sh_claim?.hasil_units])).toEqual([[IKAN, 3, 2, 0], [ANC, 1, 0, 1]]);
  });
  it("a claimed part below the minimum with a big remainder is merged too (ANC x5, min 3, one reward unit)", () => {
    const c = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 5, 15000, { minSellBase: 3 })], defs: [boltAnc()], legacy: () => [] });
    expect(c.rows.filter((r) => r.item_id === ANC).map((r) => [r.qty, r.sh_claim?.syarat_units, r.sh_claim?.hasil_units, r.promo_discount])).toEqual([[5, 0, 1, 1000]]);
  });
  it("parts that already satisfy the minimum are split as before", () => {
    const c = composeSyaratHasilCart({ rows: [row(IKAN, 4, 20000, { minSellBase: 2 }), row(ANC, 1, 15000)], defs: [boltAnc()], legacy: () => [] });
    expect(c.rows.filter((r) => r.item_id === IKAN).map((r) => [r.qty, r.sh_claim?.syarat_units ?? null])).toEqual([[2, 2], [2, null]]);
  });
  it("min is compared in BASE units (faktor): 1 pack of 12 satisfies min 12 so the line splits 2+1; at min 36 the remainder pack is merged back", () => {
    const at = (minSellBase: number) => composeSyaratHasilCart({ rows: [row(IKAN, 3, 20000, { minSellBase, faktor: 12 }), row(ANC, 1, 15000)], defs: [boltAnc()], legacy: () => [] })
      .rows.filter((r) => r.item_id === IKAN).map((r) => r.qty);
    expect(at(12)).toEqual([2, 1]);
    expect(at(36)).toEqual([3]);
  });
  it("a waiver reward line (pure) that would fall below the minimum cannot be merged: the candidate is dropped, the cart keeps the legacy result", () => {
    const c = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 5, 15000, { minSellBase: 3 })], defs: [boltAnc(1000, { allow_below_hpp: true })], legacy: () => [] });
    expect(c.strategy).toBe("none");
    expect(c.rows.some((r) => r.sh_claim)).toBe(false);
  });
});

describe("fractional quantities", () => {
  it("a fractional line (3.3 kg) never becomes a claim or a split, so no float remainder (3.3-3) can reach sale_items", () => {
    const c = composeSyaratHasilCart({ rows: [row(IKAN, 3.3, 20000), row(ANC, 1, 15000)], defs: [boltAnc()], legacy: () => [] });
    expect(c.strategy).toBe("none");
    expect(c.rows.map((r) => r.qty)).toEqual([3.3, 1]);
    const f = composeSyaratHasilCart({ rows: [row(IKAN, 2, 20000), row(ANC, 2.5, 15000)], defs: [boltAnc()], legacy: () => [] });
    expect(f.rows.map((r) => r.qty)).toEqual([2, 2.5]);
    expect(f.rows.some((r) => r.sh_claim)).toBe(false);
  });
  it("integer lines keep exact integer quantities after a split (no float residue)", () => {
    const c = composeSyaratHasilCart({ rows: [row(IKAN, 7, 20000), row(ANC, 3, 15000)], defs: [boltAnc()], legacy: () => [] });
    for (const r of c.rows) expect(Number.isInteger(r.qty)).toBe(true);
    expect(c.rows.reduce((s, r) => s + r.qty, 0)).toBe(10);
  });
});

describe("HPP guard", () => {
  const COST = (m: Record<string, number>) => async (rows: { item_id: string; qty: number }[]) => rows.map((r) => (m[r.item_id] === undefined ? null : m[r.item_id] * r.qty));
  const cartAnc = () => [row(IKAN, 2, 20000), row(ANC, 1, 15000)];
  it("hppFindingsForClaims: reward line net below cost -> blocked; waiver line -> waiverNeeded; at/above cost -> neither; unknown cost -> neither", () => {
    const base = composeSyaratHasilCart({ rows: cartAnc(), defs: [boltAnc(6000)], legacy: () => [] });
    expect(hppFindingsForClaims(base, [0, 10000])).toMatchObject({ blocked: [{ promo_id: "sh-bolt-anc" }], waiverNeeded: [] }); // 15000-6000=9000 < 10000
    expect(hppFindingsForClaims(base, [0, 9000])).toEqual({ blocked: [], waiverNeeded: [] });
    expect(hppFindingsForClaims(base, [null, null])).toEqual({ blocked: [], waiverNeeded: [] });
    const waiver = composeSyaratHasilCart({ rows: cartAnc(), defs: [boltAnc(6000, { allow_below_hpp: true })], legacy: () => [] });
    expect(waiver.rows.find((r) => r.sh_claim?.waiver)).toBeTruthy();
    expect(hppFindingsForClaims(waiver, [0, 10000])).toMatchObject({ blocked: [], waiverNeeded: [{ promo_id: "sh-bolt-anc" }] });
    expect(hppFindingsForClaims(waiver, [0, 9000])).toEqual({ blocked: [], waiverNeeded: [] });
  });
  it("a reward that would sell below cost without waiver is dropped with a cashier note - the sale is NOT failed", async () => {
    const r = await composeHppSafe({
      compose: (excludedIds) => composeSyaratHasilCart({ rows: cartAnc(), defs: [boltAnc(6000)], legacy: () => [], excludedIds }),
      quoteCosts: COST({ [ANC]: 10000, [IKAN]: 12000 }),
    });
    expect(r.composed.strategy).toBe("none");
    expect(r.composed.rows.every((x) => x.promo_discount === 0 && !x.sh_claim)).toBe(true);
    expect(r.excluded).toEqual([{ promo_id: "sh-bolt-anc", name: "Beli 2 Bolt, ANC -Rp1.000", reason: "below_hpp" }]);
    expect(r.notes).toEqual(['Promo "Beli 2 Bolt, ANC -Rp1.000" tidak diterapkan: hadiah di bawah modal.']);
  });
  it("above cost: untouched; with an Owner waiver: kept and reported as waiverNeeded", async () => {
    const ok = await composeHppSafe({ compose: (e) => composeSyaratHasilCart({ rows: cartAnc(), defs: [boltAnc(1000)], legacy: () => [], excludedIds: e }), quoteCosts: COST({ [ANC]: 10000, [IKAN]: 12000 }) });
    expect(ok.composed.strategy).toBe("syarat_hasil");
    expect(ok.excluded).toEqual([]);
    const waiver = await composeHppSafe({ compose: (e) => composeSyaratHasilCart({ rows: cartAnc(), defs: [boltAnc(6000, { allow_below_hpp: true })], legacy: () => [], excludedIds: e }), quoteCosts: COST({ [ANC]: 10000, [IKAN]: 12000 }) });
    expect(waiver.composed.strategy).toBe("syarat_hasil");
    expect(waiver.waiverNeeded.map((w) => w.promo_id)).toEqual(["sh-bolt-anc"]);
    expect(waiver.notes).toEqual([]);
  });
  it("two promos, only one breaches cost: only that one is dropped and the other is planned instead", async () => {
    const rows = [row(IKAN, 2, 20000), row(KOPI, 1, 30000), row(ANC, 1, 15000)];
    const r = await composeHppSafe({
      compose: (e) => composeSyaratHasilCart({ rows, defs: [boltAnc(6000), kopiAnc(500)], legacy: () => [], excludedIds: e }),
      quoteCosts: COST({ [ANC]: 10000, [IKAN]: 12000, [KOPI]: 20000 }),
    });
    expect(r.excluded.map((x) => x.promo_id)).toEqual(["sh-bolt-anc"]);
    expect(r.composed.applied.map((a) => a.promo_id)).toEqual(["sh-kopi-anc"]);
  });
  it("a cart without a claim never asks for costs (no extra reads on the common path)", async () => {
    let calls = 0;
    const r = await composeHppSafe({ compose: (e) => composeSyaratHasilCart({ rows: [row(KOPI, 1, 30000)], defs: [boltAnc()], legacy: () => [], excludedIds: e }), quoteCosts: async () => { calls++; return []; } });
    expect(calls).toBe(0);
    expect(r.composed.strategy).toBe("none");
  });
  it("a picked promo that gets dropped is reported so the caller can say why the pick failed", async () => {
    const r = await composeHppSafe({
      compose: (e) => composeSyaratHasilCart({ rows: cartAnc(), defs: [boltAnc(6000)], legacy: () => [], excludedIds: e, mode: "pilih", pickId: "sh-bolt-anc" }),
      quoteCosts: COST({ [ANC]: 10000, [IKAN]: 12000 }),
    });
    expect(r.composed.pick.ok).toBe(false);
    expect(r.excluded[0].promo_id).toBe("sh-bolt-anc");
  });
});
