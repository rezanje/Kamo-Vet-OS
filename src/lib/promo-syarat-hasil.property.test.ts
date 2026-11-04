import { describe, expect, it } from "vitest";
import {
  calculateSyaratHasilSafe,
  type SyaratHasilCartLine,
  type SyaratHasilDef,
  type SyaratHasilOptions,
  type SyaratHasilResult,
} from "./promo-syarat-hasil";

// ---- seeded PRNG (mulberry32): every failure is reproducible from (seed, case index) ----
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  const shuffle = <T,>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) { const j = int(0, i); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  return { next, int, pick, chance, shuffle };
}

const ITEMS = ["i0", "i1", "i2", "i3", "i4"];
const UNITS = ["PCS", "PCS", "PCS", "BOX"]; // mostly PCS so pools actually match
const PRICES = [0, 1, 2, 800, 1000, 5000, 7500, 15000, 15005, 20000, 99_999];

type Case = { lines: SyaratHasilCartLine[]; defs: SyaratHasilDef[]; options: SyaratHasilOptions };

function genCase(seed: number, index: number): Case {
  const r = rng(seed * 100_003 + index);
  const big = index % 8 === 7; // some carts with huge quantities
  const nLines = r.int(2, 8);
  const lines: SyaratHasilCartLine[] = Array.from({ length: nLines }, (_, i) => {
    const qty = big ? r.int(1, 1_000_000_000) : r.chance(0.03) ? r.pick([0, -1, 1.5]) : r.int(1, 10);
    const base: SyaratHasilCartLine = {
      source_position: i * 3 + r.int(0, 2), item_id: r.pick(ITEMS), unit: r.pick(UNITS), qty,
      unit_price: r.chance(0.02) ? r.pick([-1, 2.5]) : r.pick(PRICES), evidence_ok: !r.chance(0.08),
    };
    if (r.chance(0.08)) base.manual_discount = true;
    if (r.chance(0.45)) { // R1: what the customer is actually charged: free, cheap, exact, overcharged or garbage
      const gross = Number.isSafeInteger(qty) && Number.isSafeInteger(base.unit_price) ? qty * base.unit_price : 1000;
      base.charged = r.chance(0.05) ? r.pick([-1, 1.5, Number.NaN]) : r.pick([0, 1, Math.max(0, Math.floor(gross / 2)), gross, gross + 1000]);
    }
    if (r.chance(0.15) && Number.isSafeInteger(qty) && qty > 0) base.units_claimed_elsewhere = r.int(0, qty);
    return base;
  });
  const used = new Set<number>();
  lines.forEach((l, i) => { while (used.has(l.source_position as number)) l.source_position = (l.source_position as number) + 1000 + i; used.add(l.source_position as number); });
  const refs = () => { const n = r.int(1, 3); return r.shuffle(ITEMS).slice(0, n).map((item_id) => ({ item_id, unit: r.pick(UNITS) })); };
  const nDefs = r.int(1, 4);
  const defs: SyaratHasilDef[] = Array.from({ length: nDefs }, (_, k) => {
    const rows = Array.from({ length: r.int(1, 3) }, () => r.chance(0.25)
      ? { kind: "nilai" as const, min: r.pick([1, 1000, 20000, 100_000, 500_000]) }
      : { kind: "qty" as const, min: r.int(1, 4), items: refs() });
    const discount = r.chance(0.5)
      ? { type: "nominal" as const, value: r.pick([1, 500, 1000, 2500, 20000]) }
      : r.chance(0.5) ? { type: "percent" as const, value: r.int(1, 100), max_amount: r.pick([1, 1000, 5000]) } : { type: "percent" as const, value: r.int(1, 100) };
    return {
      id: `p${r.pick(["x", "y", "z", "a", "b", "c"])}${k}`, repeat: r.chance(0.6), syarat: rows,
      hasil: { items: refs(), reward_qty: r.chance(0.6) ? undefined : r.int(1, 3), discount },
      allow_below_hpp: r.chance(0.3),
    };
  });
  const options: SyaratHasilOptions = { one_promo_per_line: r.chance(0.25) };
  if (r.chance(0.3)) options.forced_promo_id = r.pick(defs).id;
  if (r.chance(0.2)) options.excluded_promo_ids = defs.filter((d) => d.id !== options.forced_promo_id && r.chance(0.5)).map((d) => d.id);
  return { lines, defs, options };
}

const key = (i: { item_id: string; unit: string }) => `${i.item_id}\u0000${i.unit}`;

function checkInvariants(c: Case, res: SyaratHasilResult, tag: string) {
  const at = (m: string) => `${tag}: ${m}`;
  const byPos = new Map(c.lines.map((l) => [l.source_position as number, l]));
  const defOf = new Map(c.defs.map((d) => [d.id, d]));
  expect(res.lines.length, at("every input line comes back")).toBe(c.lines.length);
  expect(res.lines.map((l) => l.source_position), at("lines sorted by source_position")).toEqual([...res.lines.map((l) => l.source_position)].sort((a, b) => a - b));

  let sumLines = 0, sumClaims = 0, cartSub = 0, cartAfter = 0;
  for (const l of res.lines) {
    const src = byPos.get(l.source_position)!;
    const computable = Number.isSafeInteger(src.qty) && src.qty >= 1 && Number.isSafeInteger(src.unit_price) && src.unit_price >= 0;
    if (!computable) {
      expect(l.gross, at("malformed -> null gross")).toBeNull();
      expect(l.net).toBeNull();
      expect(l.discount).toBe(0);
      expect(l.claims).toEqual([]);
      continue;
    }
    // R1 restated independently of the engine: min(official gross, charged) (gross when charged is absent), 0 for qty >= 1,000,000 or bad charged
    const chargedOk = src.charged === undefined || (Number.isSafeInteger(src.charged) && src.charged >= 0);
    const counted = src.qty >= 1_000_000 || !chargedOk ? 0 : Math.min(src.qty * src.unit_price, src.charged ?? Infinity);
    expect(counted, at("a line never counts more than its official gross")).toBeLessThanOrEqual(src.qty * src.unit_price);
    if (src.charged !== undefined && chargedOk) expect(counted, at("a line never counts more than what is charged")).toBeLessThanOrEqual(src.charged);
    cartSub += counted;
    // R5 restated independently: once the line's total promo discount d sits on it, it counts min(gross, charged - d) (never below 0); 0 stays 0
    cartAfter += counted === 0 ? 0 : Math.max(0, Math.min(src.qty * src.unit_price, (src.charged ?? src.qty * src.unit_price) - l.discount));
    expect(l.gross, at("gross")).toBe(src.qty * src.unit_price);
    expect(l.net, at("net = gross - discount")).toBe(l.gross! - l.discount);
    expect(l.discount, at("discount >= 0")).toBeGreaterThanOrEqual(0);
    expect(l.net!, at("net >= 0")).toBeGreaterThanOrEqual(0);
    expect(l.discount, at("discount never exceeds the line value")).toBeLessThanOrEqual(l.gross!);
    sumLines += l.discount;
    const claimedUnits = l.claims.reduce((s, x) => s + x.syarat_units + x.hasil_units, 0);
    if (l.excluded_reason) {
      expect(l.claims, at("excluded lines carry no claims")).toEqual([]);
      expect(l.discount).toBe(0);
      expect(l.net).toBe(l.gross);
      continue;
    }
    const avail = src.qty - (src.units_claimed_elsewhere ?? 0);
    expect(claimedUnits, at("no unit used twice (syarat + hasil, all promos) / never beyond what is available")).toBeLessThanOrEqual(avail);
    const hasilUnits = l.claims.reduce((s, x) => s + x.hasil_units, 0);
    expect(l.net!, at("a line with reward units keeps net > 0")).toBeGreaterThanOrEqual(hasilUnits);
    expect(l.claims.reduce((s, x) => s + x.discount, 0), at("line discount = Σ claim discount")).toBe(l.discount);
    if (c.options.one_promo_per_line) expect(new Set(l.claims.map((x) => x.promo_id)).size, at("one promo per line")).toBeLessThanOrEqual(1);
    const waiver = l.claims.some((x) => x.hasil_units > 0 && x.discount > 0 && defOf.get(x.promo_id)!.allow_below_hpp === true);
    expect(l.below_hpp_waiver, at("waiver flag")).toBe(waiver);
    expect(new Set(l.claims.map((x) => x.promo_id)).size, at("a promo appears once per line")).toBe(l.claims.length);
  }
  for (const cl of res.claims) sumClaims += cl.discount_total;
  expect(sumLines, at("Σ lines = discount_total")).toBe(res.discount_total);
  expect(sumClaims, at("Σ claims = discount_total")).toBe(res.discount_total);

  const seen = new Set<string>();
  res.claims.forEach((cl, ci) => {
    expect(seen.has(cl.promo_id), at("promo claimed once")).toBe(false);
    seen.add(cl.promo_id);
    const def = defOf.get(cl.promo_id)!;
    expect(def, at("claim refers to a def")).toBeDefined();
    expect(c.options.excluded_promo_ids ?? [], at("excluded promos never applied")).not.toContain(cl.promo_id);
    expect(cl.discount_total, at("claim applied only with a real discount")).toBeGreaterThan(0);
    expect(cl.sets_consumed).toBeGreaterThanOrEqual(1);
    expect(cl.sets_consumed).toBeLessThanOrEqual(cl.sets_available);
    if (!def.repeat) expect(cl.sets_consumed, at("no repeat -> one set")).toBe(1);
    const rq = def.hasil.reward_qty ?? 1;
    const grants = cl.hasil_units.reduce((s, h) => s + h.units, 0);
    expect(grants, at("grants")).toBe(cl.grants);
    expect(grants, at("grants <= sets*reward_qty")).toBeLessThanOrEqual(cl.sets_consumed * rq);
    expect(grants).toBeGreaterThanOrEqual(1);
    expect(cl.below_hpp_waiver).toBe(def.allow_below_hpp === true);
    expect(cl.discount_total).toBe(cl.hasil_units.reduce((s, h) => s + h.discount, 0));
    const hasilKeys = new Set(def.hasil.items.map(key));
    for (const h of cl.hasil_units) {
      const src = byPos.get(h.source_position)!;
      expect(src, at("reward unit comes from an existing line (no auto-add)")).toBeDefined();
      expect(hasilKeys.has(key(src)), at("reward line matches the hasil pool")).toBe(true);
      expect(h.discount, at("hasil discount = units * per unit")).toBe(h.units * h.discount_per_unit);
      expect(h.discount_per_unit, at("each reward unit nets >= 1")).toBeGreaterThanOrEqual(1);
      expect(h.discount_per_unit).toBeLessThanOrEqual(src.unit_price - 1);
      const d = def.hasil.discount;
      if (d.type === "nominal") expect(h.discount_per_unit).toBeLessThanOrEqual(d.value);
      else {
        expect(h.discount_per_unit).toBeLessThanOrEqual(Math.round((src.unit_price * d.value) / 100));
        if (d.max_amount !== undefined) expect(h.discount_per_unit, at("discount per reward unit never exceeds the cap")).toBeLessThanOrEqual(d.max_amount);
      }
    }
    // syarat rows hold for the consumed sets
    const sUnits = new Map(cl.syarat_units.map((s) => [s.source_position, s.units]));
    const allSyaratKeys = new Set<string>();
    for (const row of def.syarat) {
      if (row.kind === "nilai") {
        expect(cartSub, at("nilai row holds on the sum of min(official gross, charged) over the WHOLE cart")).toBeGreaterThanOrEqual(cl.sets_consumed * row.min);
        expect(cartAfter, at("R5: nilai row ALSO holds after the discount of EVERY claim (the database counts them all): reward units never qualify themselves")).toBeGreaterThanOrEqual(cl.sets_consumed * row.min);
        continue;
      }
      row.items.forEach((i) => allSyaratKeys.add(key(i)));
      const keys = new Set(row.items.map(key));
      let have = 0;
      for (const [pos, units] of sUnits) if (keys.has(key(byPos.get(pos)!))) have += units;
      expect(have, at("qty row holds for sets_consumed")).toBeGreaterThanOrEqual(cl.sets_consumed * row.min);
    }
    for (const [pos] of sUnits) expect(allSyaratKeys.has(key(byPos.get(pos)!)), at("syarat unit belongs to a syarat pool")).toBe(true);
    // line-level claims mirror claim-level units
    for (const h of cl.hasil_units) {
      const lc = res.lines.find((x) => x.source_position === h.source_position)!.claims.find((x) => x.promo_id === cl.promo_id)!;
      expect(lc.hasil_units).toBe(h.units);
      expect(lc.discount_per_unit).toBe(h.discount_per_unit);
      expect(lc.sets_consumed).toBe(cl.sets_consumed);
    }
    if (ci === 0 && res.forced?.applied) expect(cl.promo_id, at("forced promo claims first")).toBe(res.forced.promo_id);
  });
  if (c.options.forced_promo_id) {
    expect(res.forced?.promo_id).toBe(c.options.forced_promo_id);
    expect(res.forced?.applied, at("forced.applied matches claims")).toBe(res.claims.some((x) => x.promo_id === c.options.forced_promo_id));
  } else expect(res.forced).toBeNull();
}

describe("property tests: 2400 seeded random carts", () => {
  const SEED = 20261104;
  const CASES = 2400;
  it("invariants hold, results are deterministic under shuffle, inputs are never mutated", () => {
    let applied = 0, multi = 0, lost = 0, waiver = 0, forcedApplied = 0, bigCases = 0;
    for (let i = 0; i < CASES; i++) {
      const c = genCase(SEED, i);
      const tag = `seed=${SEED} case=${i}`;
      const snapshot = JSON.stringify(c);
      const res = calculateSyaratHasilSafe(c.lines, c.defs, c.options);
      expect(JSON.stringify(c), `${tag}: inputs not mutated`).toBe(snapshot);
      checkInvariants(c, res, tag);
      if (res.claims.length) applied++;
      if (res.claims.length > 1) multi++;
      if (res.alternatives.some((a) => a.status === "conflict_lost")) lost++;
      if (res.claims.some((x) => x.below_hpp_waiver)) waiver++;
      if (res.forced?.applied) forcedApplied++;
      if (i % 8 === 7) bigCases++;

      // deterministic regardless of input order (source_position given)
      const r = rng(i + 7);
      const shuffled = calculateSyaratHasilSafe(r.shuffle(c.lines), r.shuffle(c.defs), { ...c.options, excluded_promo_ids: c.options.excluded_promo_ids ? r.shuffle(c.options.excluded_promo_ids) : undefined });
      expect(JSON.stringify(shuffled), `${tag}: deterministic under shuffle`).toBe(JSON.stringify(res));
      expect(JSON.stringify(calculateSyaratHasilSafe(c.lines, c.defs, c.options)), `${tag}: repeatable`).toBe(JSON.stringify(res));

      // alternatives agree with a real forced run (sampled for speed)
      if (i % 25 === 0) {
        for (const a of res.alternatives) {
          const ex = (c.options.excluded_promo_ids ?? []).filter((x) => x !== a.promo_id);
          const forcedRun = calculateSyaratHasilSafe(c.lines, c.defs, { ...c.options, forced_promo_id: a.promo_id, excluded_promo_ids: ex, alternatives: false });
          expect(forcedRun.discount_total, `${tag}: total_if_forced ${a.promo_id}`).toBe(a.total_if_forced);
        }
      }
    }
    // guard against a vacuous generator
    expect(CASES).toBeGreaterThanOrEqual(2000);
    expect(applied).toBeGreaterThan(900);
    expect(multi).toBeGreaterThan(150);
    expect(lost).toBeGreaterThan(100);
    expect(waiver).toBeGreaterThan(200);
    expect(forcedApplied).toBeGreaterThan(150);
    expect(bigCases).toBeGreaterThan(200);
    console.log(JSON.stringify({ property_cases: CASES, with_claims: applied, multi_promo: multi, conflict_lost: lost, waiver, forced_applied: forcedApplied, big_qty_cases: bigCases }));
  }, 180_000);
});

describe("G1 property: best-of (each promo forced first) is never worse than pure greedy", () => {
  const SEED = 20261105;
  const CASES = 1500;
  it("total(best_of) >= total(greedy) in every case; strictly better somewhere; forced runs unchanged; alternatives never beat the result", () => {
    let strictlyBetter = 0, maxGap = 0, multiPromo = 0;
    for (let i = 0; i < CASES; i++) {
      const c = genCase(SEED, i);
      const tag = `seed=${SEED} case=${i}`;
      const opts: SyaratHasilOptions = { ...c.options };
      const best = calculateSyaratHasilSafe(c.lines, c.defs, opts);
      const greedy = calculateSyaratHasilSafe(c.lines, c.defs, { ...opts, conflict_strategy: "greedy" });
      expect(best.discount_total, `${tag}: best_of >= greedy`).toBeGreaterThanOrEqual(greedy.discount_total);
      checkInvariants(c, best, `${tag} best_of`);
      if (opts.forced_promo_id) {
        // the cashier's forced promo claims first and the rest is greedy: strategy must not change a forced run
        expect(JSON.stringify(best), `${tag}: forced run independent of strategy`).toBe(JSON.stringify(greedy));
      } else {
        for (const a of best.alternatives) {
          if (a.status === "excluded") continue;
          expect(a.total_if_forced, `${tag}: no applicable alternative beats the auto result (<=16 promos)`).toBeLessThanOrEqual(best.discount_total);
        }
        expect(JSON.stringify(calculateSyaratHasilSafe(c.lines, c.defs, { ...opts, alternatives: false }).claims), `${tag}: alternatives flag does not change claims`).toBe(JSON.stringify(best.claims));
      }
      if (best.discount_total > greedy.discount_total) { strictlyBetter++; maxGap = Math.max(maxGap, best.discount_total - greedy.discount_total); }
      if (best.claims.length > 1) multiPromo++;
    }
    console.log(JSON.stringify({ g1_cases: CASES, strictly_better_than_greedy: strictlyBetter, max_gap: maxGap, multi_promo: multiPromo }));
    expect(strictlyBetter, "generator must contain cases where greedy is beaten").toBeGreaterThan(5);
  }, 180_000);
});
