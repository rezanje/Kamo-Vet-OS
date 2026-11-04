import { describe, expect, it } from "vitest";
import { calculateSyaratHasilSafe } from "./promo-syarat-hasil";
import { genOracleCase, oracle, ref, type Def } from "./promo-syarat-hasil.oracle.lib";

describe("B1: overlapping syarat / hasil pools (brute-force oracle, single promo)", () => {
  const A = (qty = 1) => ({ source_position: 1, item_id: "A", unit: "u", qty, unit_price: 1000, evidence_ok: true });
  const B = (qty = 1, pos = 0) => ({ source_position: pos, item_id: "B", unit: "u", qty, unit_price: 1000, evidence_ok: true });
  const anyAB: Def = { id: "X", repeat: false, syarat: [{ kind: "qty", min: 1, items: [ref("A"), ref("B")] }], hasil: { items: [ref("B")], discount: { type: "nominal", value: 100 } } };

  it("review repro: 'any of A/B' syarat + reward B gives the same full discount in either cart order", () => {
    const ba = calculateSyaratHasilSafe([B(1, 0), A(1)], [anyAB]);
    const ab = calculateSyaratHasilSafe([{ ...A(1), source_position: 0 }, { ...B(1), source_position: 1 }], [anyAB]);
    expect(ab.discount_total).toBe(100);
    expect(ba.discount_total).toBe(100);
    expect(JSON.stringify(ba.claims.map((c) => [c.syarat_units, c.hasil_units.map((h) => h.units)]))).toBe(JSON.stringify([[[{ source_position: 1, units: 1 }], [1]]]));
  });

  it("review repro 2: reward_qty 2 and two overlapping rows (syarat {C,A} min2 + {A,C} min1, hasil A x2, cart A x2 + C x1) -> 1 reward unit", () => {
    const def: Def = {
      id: "X", repeat: false,
      syarat: [{ kind: "qty", min: 2, items: [ref("C"), ref("A")] }, { kind: "qty", min: 1, items: [ref("A"), ref("C")] }],
      hasil: { items: [ref("A")], reward_qty: 2, discount: { type: "nominal", value: 100 } },
    };
    const cart = (order: "AC" | "CA") => order === "AC"
      ? [{ ...A(2), source_position: 0 }, { item_id: "C", unit: "u", qty: 1, unit_price: 1000, evidence_ok: true, source_position: 1 }]
      : [{ item_id: "C", unit: "u", qty: 1, unit_price: 1000, evidence_ok: true, source_position: 0 }, { ...A(2), source_position: 1 }];
    expect(calculateSyaratHasilSafe(cart("AC"), [def]).discount_total).toBe(100);
    expect(calculateSyaratHasilSafe(cart("CA"), [def]).discount_total).toBe(100);
  });

  it.each([20261104, 7, 99])("sweep seed %i: 6000 random carts (1-3 syarat rows, overlapping pools), engine == oracle maximum, never above the unconstrained bound, order independent", (SEED) => {
    const CASES = 6000;
    let applied = 0, overlap = 0, engineApplied = 0;
    const bad: string[] = [];
    let badCount = 0;
    for (let i = 0; i < CASES; i++) {
      const { lines, def } = genOracleCase(SEED, i);
      const want = oracle(lines, def);
      const res = calculateSyaratHasilSafe(lines, [def], { alternatives: false });
      const grants = res.claims[0]?.grants ?? 0;
      const flipped = lines.map((l) => ({ ...l, source_position: 1000 - l.source_position }));
      const flippedTotal = calculateSyaratHasilSafe(flipped, [def], { alternatives: false }).discount_total;
      // R5: ties between equal-discount reward / syarat units are broken by source_position. When the tied lines were charged DIFFERENT amounts
      // (only reachable through partly claimed-elsewhere rows: the adapter hands a claim line its full gross) the choice can change whether the
      // nilai syarat still fits, so strict order independence is asserted for carts whose lines were charged their full gross; others are only
      // required to stay valid (the invariants of the property test) - the oracle comparison above still uses the given positions.
      const fullyCharged = lines.every((l) => l.charged === undefined || l.charged >= l.qty * l.unit_price);
      const problems: string[] = [];
      if (grants !== want.grants) problems.push(`grants ${grants} != oracle ${want.grants}`);
      if (res.discount_total !== want.money) problems.push(`money ${res.discount_total} != oracle ${want.money}`);
      if (res.discount_total > want.absMax) problems.push(`above the unconstrained bound ${want.absMax}`);
      if (fullyCharged && flippedTotal !== want.money) problems.push(`order dependent: flipped positions give ${flippedTotal}`);
      if (problems.length) { badCount++; if (bad.length < 3) bad.push(`seed=${SEED} case=${i}: ${problems.join("; ")} ${JSON.stringify({ lines, def })}`); }
      if (want.grants > 0) applied++;
      if (res.claims.length) engineApplied++;
      const syaratKeys = new Set(def.syarat.flatMap((r) => (r.kind === "qty" ? r.items.map((x) => x.item_id) : [])));
      if (def.hasil.items.some((x) => syaratKeys.has(x.item_id))) overlap++;
    }
    console.log(JSON.stringify({ oracle_cases: CASES, oracle_feasible: applied, engine_applied: engineApplied, overlapping_pools: overlap, mismatching_cases: badCount }));
    expect(bad, `${badCount} of ${CASES} cases differ from the brute-force oracle`).toEqual([]);
    expect(badCount).toBe(0);
    // generator must not be vacuous
    expect(applied).toBeGreaterThan(1200);
    expect(overlap).toBeGreaterThan(2500);
  }, 120_000);

  it("a reward-candidate unit that serves SEVERAL rows is spent first (fewest reward units lost): rows {A,B} + {B,C}, hasil {A,B,C} x2", () => {
    const def: Def = {
      id: "X", repeat: false,
      syarat: [{ kind: "qty", min: 1, items: [ref("A"), ref("B")] }, { kind: "qty", min: 1, items: [ref("B"), ref("C")] }],
      hasil: { items: [ref("A"), ref("B"), ref("C")], reward_qty: 2, discount: { type: "nominal", value: 100 } },
    };
    const lines = ["A", "C", "B"].map((item_id, i) => ({ source_position: i, item_id, unit: "u", qty: 1, unit_price: 1000, evidence_ok: true })); // B comes LAST
    const res = calculateSyaratHasilSafe(lines, [def]);
    expect(oracle(lines, def)).toMatchObject({ grants: 2, money: 200 });
    expect(res.claims[0].syarat_units).toEqual([{ source_position: 2, units: 1 }]); // B serves both rows
    expect(res.discount_total).toBe(200);                                          // A and C are the two reward units
  });

  it("syarat usage is minimal: free lines F1{X} F12{Y} F2{Z} for rows {X,Y} + {Y,Z} reserve ONE unit (Y), the others stay free for other promos", () => {
    const def: Def = {
      id: "X", repeat: false,
      syarat: [{ kind: "qty", min: 1, items: [ref("X"), ref("Y")] }, { kind: "qty", min: 1, items: [ref("Y"), ref("Z")] }],
      hasil: { items: [ref("W")], discount: { type: "nominal", value: 100 } },
    };
    const lines = ["X", "Y", "Z", "W"].map((item_id, i) => ({ source_position: i, item_id, unit: "u", qty: 1, unit_price: 1000, evidence_ok: true }));
    const res = calculateSyaratHasilSafe(lines, [def]);
    expect(res.claims[0].syarat_units).toEqual([{ source_position: 1, units: 1 }]);
    // and the freed X unit can serve a second promo on the same cart
    const other: Def = { id: "Y2", repeat: false, syarat: [{ kind: "qty", min: 1, items: [ref("X")] }], hasil: { items: [ref("Z")], discount: { type: "nominal", value: 50 } } };
    expect(calculateSyaratHasilSafe(lines, [def, other], { conflict_strategy: "greedy" }).claims.map((c) => c.promo_id).sort()).toEqual(["X", "Y2"]);
  });

  it.each([4, 5])("wider promos: up to %i qty rows (greedy cover is exact on this sweep), 6000 carts", (rows) => {
    let bad = 0, applied = 0;
    const examples: string[] = [];
    for (let i = 0; i < 6000; i++) {
      const { lines, def } = genOracleCase(555, i, rows);
      const want = oracle(lines, def);
      const res = calculateSyaratHasilSafe(lines, [def], { alternatives: false });
      if (want.grants > 0) applied++;
      if ((res.claims[0]?.grants ?? 0) !== want.grants || res.discount_total !== want.money || res.discount_total > want.absMax) { bad++; if (examples.length < 2) examples.push(JSON.stringify({ lines, def, engine: res.discount_total, want })); }
    }
    expect(examples).toEqual([]);
    expect(bad).toBe(0);
    expect(applied).toBeGreaterThan(800);
  }, 120_000);
});
