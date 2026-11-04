// Differential generator for scripts/test-promo-syarat-hasil-postgres.py: runs the REAL stage-1 engine on seeded random carts and
// prints one JSON scenario per line (promos as DB rules + cart + the engine's claims). The native test then loads every scenario into the
// database and finalizes it through the original cashier RPC: whatever the engine claims, the database verification must accept.
// R1: carts now contain lines the cashier overrode (harga below the official price, manual nominal discounts); the engine sees them through
// the REAL adapter (syaratHasilLinesFromCart -> charged), so nilai rows are measured with the new rule "min(official gross, actually charged)".
// R5 (stage 3): the cart value is the money actually charged AFTER the discount of every claim (reward units never qualify their own nilai), so the
// expected value of a scenario is nilaiOf(lines) - total_discount, and promos with a nilai row are TIGHTENED (min = value after the engine's own
// claims / sets) so that the exact boundary is exercised often. Boundary variants: a promo's nilai minimum is often set to exactly the nilai value of the cart (TS restatement of the rule). The base
// scenario (engine claims, nilai == need) must be ACCEPTED; the SHAVED variant (same claims, one rupiah of manual discount added to a
// counted non-claimed line, so nilai == need - 1) must be REFUSED with PROMO_SH_NILAI (expect REFUSE_NILAI): the database is neither
// looser nor stricter than the engine's rule at the boundary.
// Stage 3: every scenario with claims is ALSO produced through the cashier composer (src/lib/promo-syarat-hasil-checkout.ts: the exact claim lines
// kasir/checkout.ts writes - split into claimed units and plain remainder, source positions renumbered), tagged src:"composer"; the database must accept them too.
// Usage: node --no-warnings --import ./scripts/ts-register.mjs scripts/promo-syarat-hasil-diff-gen.mts <seed> <count>
import { calculateSyaratHasilSafe, syaratHasilLinesFromCart, type SyaratHasilDef } from "../src/lib/promo-syarat-hasil.ts";
import { composeSyaratHasilCart, type ShRow } from "../src/lib/promo-syarat-hasil-checkout.ts";

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

function promo(id: string, cartNilai: number): SyaratHasilDef {
  const rows: SyaratHasilDef["syarat"] = [];
  const nRows = int(1, 3);
  let nilai = false;
  for (let i = 0; i < nRows; i++) {
    if (!nilai && rnd() < 0.4) { rows.push({ kind: "nilai", min: rnd() < 0.5 ? Math.max(1, Math.floor(cartNilai / pick([1, 1, 2, 3]))) : pick([5000, 12000, 20000, 40000, 60000]) }); nilai = true; }
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

type Ln = { pos: number; item: string; price: number; qty: number; harga: number; manual: number };
const rowsOf = (ls: Ln[]) => ls.map((l) => ({ item_id: l.item, qty: l.qty, harga: l.harga, satuan: "PCS", faktor: 1, officialPrice: l.price, manualOverride: l.harga !== l.price,
  item_discount_type: l.manual > 0 ? "nominal" : null, item_discount_value: l.manual }));
// independent TS restatement of the nilai rule for the expectation: min(official gross, qty x harga - manual), qty bound 1e6
const nilaiOf = (ls: Ln[]) => ls.reduce((s, l) => s + (l.qty >= 1_000_000 ? 0 : Math.min(l.qty * l.price, l.qty * l.harga - Math.min(l.manual, l.qty * l.harga))), 0);

for (let idx = 0; idx < count; idx++) {
  const lines: Ln[] = Array.from({ length: int(1, 5) }, (_, pos) => {
    const it = pick(ITEMS), qty = int(1, 6);
    let harga = it.price, manual = 0;
    if (rnd() < 0.2) harga = Math.round(it.price * pick([0.6, 0.8, 0.95])); // tier / negotiated price below the official price
    if (rnd() < 0.2) manual = int(1, Math.floor((qty * harga * 4) / 10)); // genuine manual nominal discount (<= 40% of the line)
    return { pos, item: it.id, price: it.price, qty, harga, manual };
  });
  const defs: SyaratHasilDef[] = Array.from({ length: int(1, 2) }, (_, k) => promo(`f4000000-0000-4000-8000-${String(idx * 2 + k).padStart(12, "0")}`, nilaiOf(lines)));
  const cartRows = syaratHasilLinesFromCart(rowsOf(lines));
  let r = calculateSyaratHasilSafe(cartRows, defs, { one_promo_per_line: true, alternatives: false });
  // tighten: the nilai row of a claimed promo := the money left after ALL claims / the sets it consumed (when divisible); keep it only if the engine still makes the same claims
  const netAfter = nilaiOf(lines) - r.discount_total;
  if (rnd() < 0.7) {
    for (const c of r.claims) {
      const d = defs.find((x) => x.id === c.promo_id) as SyaratHasilDef;
      const k = d.syarat.findIndex((row) => row.kind === "nilai");
      if (k < 0 || c.sets_consumed < 1 || netAfter % c.sets_consumed !== 0 || netAfter / c.sets_consumed < 1) continue;
      const tightened = defs.map((x) => (x === d ? { ...x, syarat: x.syarat.map((row, j) => (j === k ? { kind: "nilai" as const, min: netAfter / c.sets_consumed } : row)) } : x));
      const r2 = calculateSyaratHasilSafe(cartRows, tightened, { one_promo_per_line: true, alternatives: false });
      if (JSON.stringify(r2.claims.map((x) => [x.promo_id, x.sets_consumed, x.syarat_units, x.hasil_units])) === JSON.stringify(r.claims.map((x) => [x.promo_id, x.sets_consumed, x.syarat_units, x.hasil_units]))) { defs.splice(0, defs.length, ...tightened); r = r2; }
      break;
    }
  }
  const claims: object[] = [];
  let multi = false;
  for (const l of r.lines) {
    if (l.claims.length > 1) multi = true;
    for (const c of l.claims) claims.push({ pos: l.source_position, promo: c.promo_id, sets: c.sets_consumed, syarat: c.syarat_units, hasil: c.hasil_units, disc: c.discount });
  }
  if (multi) continue;
  console.log(JSON.stringify({ idx, promos: defs.map((d) => ({ id: d.id, rule: ruleOf(d) })), lines, claims, total_discount: r.discount_total }));
  if (claims.length > 0) {
    // the same cart through the cashier composer (no legacy promos in this fixture's item set); its final rows become the sale lines
    const shRows: ShRow[] = lines.map((l) => ({ item_id: l.item, qty: l.qty, harga: l.harga, satuan: "PCS", faktor: 1, item_type: "Persediaan", officialPrice: l.price,
      item_discount_type: l.manual > 0 ? "nominal" : null, item_discount_value: l.manual }));
    const comp = composeSyaratHasilCart({ rows: shRows, defs, legacy: () => [] });
    const cClaims = comp.rows.flatMap((row, pos) => (row.sh_claim ? [{ pos, promo: row.sh_claim.promo_id, sets: row.sh_claim.sets, syarat: row.sh_claim.syarat_units, hasil: row.sh_claim.hasil_units, disc: row.sh_claim.hasil_units > 0 ? row.promo_discount : 0 }] : []));
    if (cClaims.length > 0) {
      const cLines = comp.rows.map((row, pos) => ({ pos, item: row.item_id, price: row.officialPrice as number, qty: row.qty, harga: row.harga, manual: row.item_discount_value ?? 0 }));
      console.log(JSON.stringify({ idx, src: "composer", promos: defs.map((d) => ({ id: d.id, rule: ruleOf(d) })), lines: cLines, claims: cClaims, total_discount: comp.savings.total }));
    }
  }
  // boundary variant: nilai == need exactly -> shave 1 Rp off a counted, non-claimed line
  const need = r.claims.reduce((m, c) => {
    const d = defs.find((x) => x.id === c.promo_id) as SyaratHasilDef;
    return d.syarat.reduce((mm, row) => (row.kind === "nilai" ? Math.max(mm, c.sets_consumed * row.min) : mm), m);
  }, 0);
  const claimedPos = new Set((claims as { pos: number }[]).map((x) => x.pos));
  const victim = lines.find((l) => !claimedPos.has(l.pos) && l.qty * l.harga - l.manual >= 2 && l.harga <= l.price);
  if (need > 0 && nilaiOf(lines) - r.discount_total === need && victim) { // R5: the value after every claim's discount sits exactly on the boundary
    const shaved = lines.map((l) => (l === victim ? { ...l, manual: l.manual + 1 } : l));
    if (nilaiOf(shaved) - r.discount_total !== need - 1) throw new Error("generator bug: boundary arithmetic");
    console.log(JSON.stringify({ idx, expect: "REFUSE_NILAI", promos: defs.map((d) => ({ id: d.id, rule: ruleOf(d) })), lines: shaved, claims, total_discount: r.discount_total }));
  }
}
