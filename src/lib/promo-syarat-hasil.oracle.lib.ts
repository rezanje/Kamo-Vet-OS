// TEST-ONLY helper (brute-force oracle + seeded generator) shared by promo-syarat-hasil.oracle.test.ts. Not production code.
import type { SyaratHasilCartLine, SyaratHasilDef } from "./promo-syarat-hasil";

/**
 * Brute-force ORACLE for a SINGLE promo on a tiny cart (review finding B1: syarat units and reward
 * units come from overlapping pools, so which units satisfy the syarat decides how many reward
 * units remain).
 *
 * The oracle expands every line into individual units and enumerates EVERY subset of units that
 * could be reserved as syarat units. For a subset m:
 *   a      = sets the syarat allow with the units of m (min over rows; nilai rows use the whole cart; 1 without repeat)
 *   g      = min(a * reward_qty, reward units NOT in m)          (partial last set allowed, as in the engine)
 *   valid  = g >= 1 and m is MINIMAL for ceil(g / reward_qty) sets (no unit of m can be dropped)
 *   money  = sum of the g LOWEST per-unit discounts among the free reward units (engine pick rule)
 * Best = MAXIMUM g, then the LOWEST money among assignments with that g (margin-protecting tie-break, same stance as the
 * approved "lowest discount first" reward pick). `absMax` = most money ANY valid assignment could give if
 * the g reward units could be chosen freely (upper bound: the engine may never exceed it).
 */
export type OLine = SyaratHasilCartLine & { source_position: number };
export type Def = SyaratHasilDef;

function unitDiscount(d: Def["hasil"]["discount"], price: number): number {
  if (price <= 1) return 0;
  let raw = d.type === "nominal" ? d.value : Math.floor((price * d.value + 50) / 100);
  if (d.type === "percent" && d.max_amount !== undefined) raw = Math.min(raw, d.max_amount);
  return Math.min(raw, price - 1);
}

export function oracle(lines: OLine[], def: Def): { grants: number; money: number; absMax: number } {
  const key = (l: { item_id: string; unit: string }) => `${l.item_id}\u0000${l.unit}`;
  const cartSub = lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const units: { line: number; dpu: number }[] = [];
  const hasilKeys = new Set(def.hasil.items.map(key));
  lines.forEach((l, i) => {
    const eligible = l.evidence_ok === true && l.manual_discount !== true;
    const avail = eligible ? l.qty - (l.units_claimed_elsewhere ?? 0) : 0;
    const d = hasilKeys.has(key(l)) ? unitDiscount(def.hasil.discount, l.unit_price) : 0;
    for (let k = 0; k < avail; k++) units.push({ line: i, dpu: d });
  });
  const U = units.length;
  const rq = def.hasil.reward_qty ?? 1;
  // row masks over units
  const rowMasks = def.syarat.map((r) => {
    if (r.kind === "nilai") return null;
    const keys = new Set(r.items.map(key));
    let mask = 0;
    units.forEach((u, idx) => { if (keys.has(key(lines[u.line]))) mask |= 1 << idx; });
    return mask;
  });
  let rewardMask = 0;
  units.forEach((u, idx) => { if (u.dpu > 0) rewardMask |= 1 << idx; });
  const pop = (x: number) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
  const setsFor = (m: number): number => {
    let a = Infinity;
    def.syarat.forEach((r, j) => {
      const met = r.kind === "nilai" ? cartSub : pop(m & (rowMasks[j] as number));
      a = Math.min(a, Math.floor(met / r.min));
    });
    return a;
  };
  const holds = (m: number, sets: number): boolean => def.syarat.every((r, j) => (r.kind === "nilai" ? cartSub : pop(m & (rowMasks[j] as number))) >= sets * r.min);
  let bestG = 0, bestMoney = Infinity, absMax = 0;
  for (let m = 0; m < 1 << U; m++) {
    let a = setsFor(m);
    if (a < 1) continue;
    if (!def.repeat) a = 1;
    const free: number[] = [];
    for (let idx = 0; idx < U; idx++) if (!(m >> idx & 1) && (rewardMask >> idx & 1)) free.push(units[idx].dpu);
    const g = Math.min(a * rq, free.length);
    if (g < 1) continue;
    const s = Math.ceil(g / rq);
    let minimal = true;
    for (let idx = 0; idx < U && minimal; idx++) if ((m >> idx & 1) && holds(m & ~(1 << idx), s)) minimal = false;
    if (!minimal) continue;
    free.sort((x, y) => x - y);
    const money = free.slice(0, g).reduce((x, y) => x + y, 0);
    const top = free.slice(free.length - g).reduce((x, y) => x + y, 0);
    absMax = Math.max(absMax, top);
    if (g > bestG || (g === bestG && money < bestMoney)) { bestG = g; bestMoney = money; }
  }
  return { grants: bestG, money: bestG === 0 ? 0 : bestMoney, absMax };
}

// ---- seeded PRNG ----
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
  const chance = (p: number) => next() < p;
  const subset = <T,>(xs: readonly T[], n: number): T[] => {
    const pool = [...xs];
    const out: T[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    return out;
  };
  return { next, int, chance, subset };
}

const ITEMS = ["A", "B", "C", "D"];
export const ref = (item_id: string) => ({ item_id, unit: "u" });

export function genOracleCase(seed: number, index: number, maxRows = 3): { lines: OLine[]; def: Def } {
  const r = rng(seed * 7919 + index);
  for (;;) {
    const nLines = r.int(1, 4);
    const lines: OLine[] = Array.from({ length: nLines }, (_, i) => {
      const qty = r.int(1, 6);
      const l: OLine = {
        source_position: i * 2 + r.int(0, 1), item_id: ITEMS[r.int(0, ITEMS.length - 1)], unit: "u", qty,
        unit_price: r.chance(0.08) ? r.int(0, 1) : r.int(2, 30) * 500, evidence_ok: !r.chance(0.07),
      };
      if (r.chance(0.07)) l.manual_discount = true;
      if (r.chance(0.12)) l.units_claimed_elsewhere = r.int(0, qty);
      return l;
    });
    const positions = new Set(lines.map((l) => l.source_position));
    if (positions.size !== lines.length) continue;
    const units = lines.reduce((s, l) => s + l.qty, 0);
    if (units > 11) continue; // 2^11 subsets per case
    const rows = Array.from({ length: r.int(1, maxRows) }, () => r.chance(0.12)
      ? { kind: "nilai" as const, min: r.int(1, 12) * 1000 }
      : { kind: "qty" as const, min: r.int(1, 3), items: r.subset(ITEMS, r.int(1, 3)).map(ref) });
    const d = r.chance(0.5)
      ? { type: "nominal" as const, value: r.int(1, 8) * 500 }
      : { type: "percent" as const, value: r.int(1, 100), ...(r.chance(0.5) ? { max_amount: r.int(1, 6) * 500 } : {}) };
    const def: Def = {
      id: "P", repeat: r.chance(0.6), syarat: rows,
      hasil: { items: r.subset(ITEMS, r.int(1, 3)).map(ref), reward_qty: r.chance(0.5) ? undefined : r.int(1, 3), discount: d },
    };
    return { lines, def };
  }
}

