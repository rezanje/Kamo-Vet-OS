// Differential generator for scripts/test-promo-syarat-hasil-postgres.py: runs the REAL stage-1 engine on seeded random carts and
// prints one JSON scenario per line (promos as DB rules + cart + the engine's claims). The native test then loads every scenario into the
// database and finalizes it through the original cashier RPC: whatever the engine claims, the database verification must accept.
// Usage: node --no-warnings scripts/promo-syarat-hasil-diff-gen.mts <seed> <count>
import { calculateSyaratHasilSafe, type SyaratHasilDef } from "../src/lib/promo-syarat-hasil.ts";

const seed = Number(process.argv[2] ?? 1), count = Number(process.argv[3] ?? 100);
let a = seed >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)];
const ITEMS = [
  { id: "e5500000-0000-4000-8000-0000000000d1", price: 7000 },
  { id: "e5500000-0000-4000-8000-0000000000d2", price: 12500 },
  { id: "e5500000-0000-4000-8000-0000000000d3", price: 5000 },
  { id: "e5500000-0000-4000-8000-0000000000d4", price: 9000 },
];
const subset = (maxN: number) => { const xs = [...ITEMS].sort(() => rnd() - 0.5); return xs.slice(0, int(1, maxN)).map((x) => ({ item_id: x.id, unit: "PCS" })); };

function promo(id: string): SyaratHasilDef {
  const rows: SyaratHasilDef["syarat"] = [];
  const nRows = int(1, 3);
  let nilai = false;
  for (let i = 0; i < nRows; i++) {
    if (!nilai && rnd() < 0.25) { rows.push({ kind: "nilai", min: pick([5000, 12000, 20000, 40000, 60000]) }); nilai = true; }
    else rows.push({ kind: "qty", min: int(1, 3), items: subset(3) });
  }
  if (!rows.some((r) => r.kind === "qty")) rows.push({ kind: "qty", min: int(1, 2), items: subset(3) });
  const discount = rnd() < 0.5 ? { type: "nominal" as const, value: pick([500, 1000, 1500, 3000]) }
    : { type: "percent" as const, value: pick([10, 25, 50, 60]), ...(rnd() < 0.5 ? { max_amount: pick([500, 1000, 2000]) } : {}) };
  const hasil: SyaratHasilDef["hasil"] = { items: subset(2), discount };
  if (rnd() < 0.5) hasil.reward_qty = int(1, 2);
  return { id, repeat: rnd() < 0.6, syarat: rows, hasil };
}

const ruleOf = (d: SyaratHasilDef) => ({
  discount_mode: "syarat_hasil", suggest: "diff",
  syarat_hasil: { version: 1, repeat: d.repeat, syarat: d.syarat,
    hasil: { kind: "barang", items: d.hasil.items, ...(d.hasil.reward_qty ? { reward_qty: d.hasil.reward_qty } : {}), discount: d.hasil.discount }, below_hpp: { allowed: false } },
});

for (let idx = 0; idx < count; idx++) {
  const defs = Array.from({ length: int(1, 2) }, (_, k) => promo(`f4000000-0000-4000-8000-${String(idx * 2 + k).padStart(12, "0")}`));
  const lines = Array.from({ length: int(1, 5) }, (_, pos) => { const it = pick(ITEMS); return { pos, item: it.id, price: it.price, qty: int(1, 6) }; });
  const r = calculateSyaratHasilSafe(lines.map((l) => ({ source_position: l.pos, item_id: l.item, unit: "PCS", qty: l.qty, unit_price: l.price, evidence_ok: true })), defs,
    { one_promo_per_line: true, alternatives: false });
  const claims: object[] = [];
  let multi = false;
  for (const l of r.lines) {
    if (l.claims.length > 1) multi = true;
    for (const c of l.claims) claims.push({ pos: l.source_position, promo: c.promo_id, sets: c.sets_consumed, syarat: c.syarat_units, hasil: c.hasil_units, disc: c.discount });
  }
  if (multi) continue;
  console.log(JSON.stringify({ idx, promos: defs.map((d) => ({ id: d.id, rule: ruleOf(d) })), lines, claims, total_discount: r.discount_total }));
}
