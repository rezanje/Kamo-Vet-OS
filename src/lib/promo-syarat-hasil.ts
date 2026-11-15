/**
 * Promo "Syarat -> Hasil" (Accurate-style trigger/reward) — PURE calculation engine, stage 1.
 *
 * No I/O, no DB, no float math: every rupiah figure is an integer and all products are computed
 * with BigInt, so large quantities/prices cannot lose precision and no loop walks unit-by-unit
 * (set counts are found in closed form / binary search). Inputs are never mutated, output is
 * deterministic and independent of input order whenever `source_position` is given.
 *
 * NOT wired anywhere yet. Further wiring notes: /opt/data/kamo-promo-bundle-evidence/syarat-hasil-stage1-report.json.
 *
 * LATER-STAGE / WIRING CHECKLIST (from the stage-1 review; none of it is enforced here):
 *  - NO HPP FLOOR inside the engine. A promo without allow_below_hpp can discount a reward unit down to net 1; the picker /
 *    server / DB floor check (a later stage) MUST reject or clamp any claim whose net < HPP unless `below_hpp_waiver` is set,
 *    and must not stack a waiver line with voucher / points / total discount. If that stage is forgotten, Rp1 sales are possible.
 *  - units_claimed_elsewhere must be PER-LINE UNIT COUNTS. The Bolt 2/6 quantity_pool is all-or-nothing per line (pass the whole
 *    line qty when the pool claimed any unit); legacy per_unit promos claim `qtyKena` units, and package_total spreads RUPIAH
 *    over lines, so it needs a unit count derived per line, not the rupiah. Legacy per_unit with empty itemIds means ALL items.
 *  - The SERVER must rebuild the lines from the master (items / item_units / prices). The adapter's evidence fields
 *    (faktor, officialPrice, harga, manualOverride, unitsClaimedElsewhere) are CLIENT-SUPPLIED: never trust them at finalisation.
 *  - Syarat-only lines (a line whose units were only reserved as syarat) produce no PotonganBaris / sale_items discount:
 *    persistence needs its own column or table for the reserved syarat units, otherwise a reopened sale cannot know which
 *    units were consumed.
 *  - discountType NULL TRAP: hitungPromoKeranjang's active filter is (!!p.discountType || mode === "quantity_pool"), so
 *    syarat_hasil promos (discount_type NULL) are silently dropped; the filter and promoDiscountMode (throws on an unknown
 *    mode, and loadPromoAktif / promoPricingRule map EVERY active promo, with a duplicate mapper in kasir/page.tsx) must be
 *    extended BEFORE any syarat_hasil promo is activated, otherwise every checkout breaks. Activate last.
 *  - one_promo_per_line: true until sale_items can hold more than one promo_id per line.
 *  - The caller MUST check `forced.code !== null` (reject checkout), `skipped` (stale promos) and `skipped_lines` (lines that
 *    could not be used) and compare the legacy minSubtotal gate (cart harga before promos) with the engine's nilai basis.
 *
 * PERFORMANCE / WORST CASE: a plan is cached per promo and only re-planned when a commit touched one of its lines, and a
 * plan probes O(log N) set counts (1-4 for real carts). Cost ~ (1 + up to 16 forced runs [+ all promos when `alternatives`])
 * pipelines. Measured (2-core host, idle -> loaded): 64 promos x (8 rows x 50 items) x 200 lines with qty ~1e6 per line WITH
 * alternatives 0.3s -> 1.0s, alternatives:false 0.1s -> 0.4s, conflict_strategy "greedy" + alternatives:false <0.1s -> 0.2s;
 * 2000 lines x 64 such promos was ~11s in the stage-1 review (before this fix) and is NOT re-measured: SH_MAX_LINES=2000 is a
 * contract cap, not a promise. The worst-case input (huge qty, every pool overlapping the reward pool, 64 live promos) is
 * what the perf test guards (< 1.5s, best of 2). Checkout (server) should call with `alternatives: false`; the client
 * UI should debounce when it asks for alternatives.
 *
 * Semantics (approved Andri decisions, 4 Nov 2026, supersede the design defaults):
 *  - A promo = 1..8 syarat rows (AND-ed) + exactly one hasil.
 *      syarat `qty`   : minimum quantity over a POOL of (item, unit) entries (variants count together).
 *      syarat `nilai` : minimum subtotal of the WHOLE CART (Q3, Andri: "nilai belanja = seluruh keranjang").
 *                       R1 REFINEMENT (stage-2 re-review, decision of the parent agent, NOT yet confirmed by Andri - Andri/Reza
 *                       may overrule): Andri did not say "before discount"; the earlier reading "official price before any
 *                       discount" made the threshold a cashier-controlled number, because harga, manual discount and qty are
 *                       client-written and lines without an HPP floor (Jasa / Non-Persediaan) can be priced at Rp1, 100%
 *                       discounted or sold in qty 1,000,000 at harga 0. Therefore every line counts at
 *                           LESSER( qty * unit_price (official master price), charged )
 *                       where `charged` is what the customer is actually charged for the line: qty * harga minus the line's
 *                       manual / item discount (or the server-derived discount of another mechanism, e.g. the Bolt pool), before
 *                       cart-level voucher / points / total discount. R5 (stage 3): a claimed reward line is NOT special: its own reward discount
 *                       (and the discount of every promo applied before it) IS subtracted, so reward units never qualify their own
 *                       nilai syarat and the threshold means the money actually charged for the cart (a cart of only one reward unit
 *                       paid Rp14.000 counts Rp14.000). The engine therefore plans `repeat` sets as the largest count whose own reward
 *                       discount still leaves nilai >= sets x min (all promos together, see SHARED SPEND), and a later promo may not push the money below what the
 *                       earlier claims already consumed (State.need): the database counts the discount of EVERY claim. So a line
 *                       never counts more than the real money in the cart nor more than the official price (a tier price
 *                       counts at what is paid; an overcharge adds nothing). Manual-discount / no-evidence lines and units
 *                       claimed elsewhere still count (at their charged amount). A line with qty >= SH_NILAI_MAX_LINE_QTY
 *                       (1,000,000) counts 0 (defence in depth against absurd quantities), a line without an official price
 *                       (free text, clinic, inactive item) counts 0, an invalid `charged` counts 0. When `charged` is ABSENT the
 *                       engine counts qty * unit_price (direct callers vouch for unit_price; the adapter
 *                       `syaratHasilLinesFromCart` ALWAYS derives `charged`). `unit_price` stays the official price (reward
 *                       discounts are computed on it). The DB (promo_sh_verify_claims) applies the same rule. nilai reserves no units.
 *      hasil          : nominal Rp off the reward item's NORMAL price per reward unit, or percent
 *                       (integer 1..100, half-up rounding per unit) with an optional Rp cap that applies
 *                       PER REWARD UNIT (Q4). `reward_qty` reward units per syarat set (default 1).
 *  - `repeat` (kelipatan): sets = min over rows of floor(met / min). Without repeat: 0 or 1.
 *  - SHARED SPEND (Andri 11 Nov 2026, PayDay 11.11: "setiap 100k tidak bisa ditambah dengan item2 hadiah syarat yang lain"): the `nilai`
 *    syarat is ONE pool of money per receipt, not a gate every promo passes on its own. Every set of a promo that has a nilai row
 *    consumes `sets x (largest nilai row of that promo)` of the money actually charged for the cart (after every reward discount, R5),
 *    and the consumption of all promos together may never exceed that money: a rupiah of spend cannot satisfy two promos. So a
 *    Rp155.000 cart with seven "Belanja min Rp100.000" promos buys ONE reward set, Rp250.000 buys two, and the order of the cart lines /
 *    promos changes nothing. Which rewards win is the conflict rule below (biggest saving for the customer, ties -> smaller promo id).
 *    The reward discount lands on the reward units only (reward_qty x sets, never above the units in the cart), never on the other units
 *    of the same item. Promos with only qty rows consume no spend. The DB (promo_sh_verify_claims) enforces the same aggregate.
 *  - The reward must already be in the cart (no auto-add). Reward units come from lines matching the
 *    hasil pool, may be ANY variant of it, and are disjoint from the syarat units of the same promo.
 *    Which reward units are discounted: LOWEST resulting discount first, ties -> source_position,
 *    then item_id (protects margin; deterministic).
 *  - Net of a reward unit always stays >= 1: the per-unit discount is clamped to price-1, units whose
 *    clamped discount would be 0 (price <= 1) are not reward candidates (Q5). Below-HPP is NOT checked
 *    here (no HPP in this layer): `allow_below_hpp` is only exposed as `below_hpp_waiver` on claims and
 *    lines; a waiver line must not stack with voucher/points/total discount (later stage).
 *  - A unit belongs to at most ONE promo and plays at most ONE role (syarat OR hasil) — across promos too.
 *    A syarat unit counts for EVERY qty row whose pool contains it (rows are AND-ed over the same units).
 *  - Which units satisfy the syarat (B1, review): when the syarat pool and the reward pool OVERLAP (e.g. "any 1 of A/B"
 *    -> B discounted) the reservation must not eat the only reward unit, so the result must not depend on cart order.
 *    Rule, deterministic: (1) lines that cannot be a reward ("free" lines) are reserved first: rows in order, earliest
 *    source_position first, a later row first re-uses units already reserved by earlier rows; (2) what is still missing is
 *    covered with reward-candidate lines, repeatedly the line serving the MOST unmet rows, ties -> HIGHEST discount per unit
 *    discount per unit first (cheaper reward units stay free), then source_position, then item_id; (3) surplus is pruned. GUARANTEED:
 *    the result is deterministic and independent of cart order, and never grants MORE reward units than feasible. In practice
 *    (brute-force oracle: 18,000 random carts with 1-3 syarat rows, exploratory 4-5 rows) it also reaches the MAXIMUM number
 *    of grants, but that is a greedy cover, not a proof of optimality (it can under-grant on 6-8 heavily overlapping rows, review V2-2).
 *    NOT guaranteed (review V2-1): that the discount is the LOWEST among max-grant assignments. The reservation prefers the unit that serves
 *    the most unmet rows before cost, so that unit may be the cheapest reward unit and the customer then gets a larger discount than the
 *    minimum possible (~0.01-0.02% of random 1-5 row carts; characterised in the test "V2-1"). The discount is still a valid
 *    reward-unit discount under the promo definition; the DB later re-checks feasibility and bounds only, never this tie-break.
 *  - Conflicts between promos (they want the same units), G1: BEST-OF. The engine runs (a) greedy by SAVINGS — repeatedly the
 *    promo that saves the customer the most on the units still free wins, ties -> smaller id (UTF-16 code units, SQL
 *    `COLLATE "C"`) — and (b) "promo P claims first, then greedy" for every applicable promo P (at most
 *    SH_MAX_FORCED_CANDIDATES = 16, the biggest standalone savings first, ties smaller id; deterministic and independent of the
 *    `alternatives` flag), and keeps the run with the biggest total (ties: greedy, then the smaller id). So the result is never
 *    below plain greedy (A1 saving 100 no longer blocks B1+B2 saving 180). It is still NOT a global optimum (a promo ordering
 *    deeper than "one promo first" is not searched, nor candidates beyond the cap); `alternatives[].total_if_forced` shows the
 *    cashier the forced-first total of every promo. `conflict_strategy: "greedy"` = the old single pass (fast path).
 *    Promos on disjoint units all run (Q1/Q2). The cashier can override with `forced_promo_id` (claims first, rest greedy on
 *    what is left; no best-of search) and cancel with `excluded_promo_ids`.
 *  - Manual-discount lines, lines without official-price evidence and malformed lines never take part.
 *  - An invalid/stale promo is SKIPPED and reported (never blocks the others) in the SAFE entry.
 *  - Returns are manual (delete transaction / edit payment): NO refund or clawback logic here. The
 *    per-line claims carry what later stages need to persist (promo id, sets consumed, per-unit discount).
 *  - The Bolt 2/6 quantity_pool is NOT part of this engine: the caller passes the units it already
 *    claimed as `units_claimed_elsewhere` per line; this engine never touches those units.
 */

export const SH_MAX_SYARAT_ROWS = 8;
export const SH_MAX_ROW_ITEMS = 50;
export const SH_MAX_HASIL_ITEMS = 20;
export const SH_MAX_MONEY = 99_999_999;
export const SH_MAX_QTY_MIN = 99_999;
export const SH_MAX_REWARD_QTY = 999;
/** Caller-contract caps: the greedy conflict resolution is O(promos^2) plans per run. */
export const SH_MAX_PROMOS = 64;
export const SH_MAX_LINES = 2_000;
/** R1: a single line of this many units or more counts 0 toward a `nilai` syarat (absurd-quantity defence; the DB uses the same bound). */
export const SH_NILAI_MAX_LINE_QTY = 1_000_000;
/**
 * Best-of conflict search (G1) tries "this promo claims first, then greedy" for at most this many
 * promos (the ones with the biggest standalone savings, ties -> smaller id). Deterministic, independent of the
 * `alternatives` flag. Beyond it the remaining promos are only reachable through plain greedy.
 */
export const SH_MAX_FORCED_CANDIDATES = 16;

export type SyaratHasilErrorCode =
  | "SH_EMPTY_SYARAT"
  | "SH_EMPTY_HASIL"
  | "SH_ROW_INVALID"
  | "SH_DISCOUNT_INVALID"
  | "SH_LINE_POSITION_DUPLICATE"
  | "SH_LINE_POSITION_INVALID"
  | "SH_OVERFLOW"
  | "SH_TOO_LARGE"
  | "SH_BAD_INPUT"
  | "SH_DUPLICATE_ID"
  | "SH_FORCED_NOT_FOUND"
  | "SH_FORCED_SKIPPED"
  | "SH_FORCED_NOT_APPLICABLE"
  | "SH_FORCED_EXCLUDED";

export class SyaratHasilError extends Error {
  readonly code: SyaratHasilErrorCode;
  constructor(code: SyaratHasilErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SyaratHasilError";
    this.code = code;
  }
}

export type SyaratHasilItemRef = { item_id: string; unit: string };
export type SyaratRow =
  | { kind: "qty"; min: number; items: SyaratHasilItemRef[] }
  /** Whole-cart subtotal (normal price, before discounts). Carries no items. */
  | { kind: "nilai"; min: number };
export type HasilDiscount =
  | { type: "nominal"; value: number }
  | { type: "percent"; value: number; max_amount?: number };

export type SyaratHasilDef = {
  /** Required, unique, non-empty text (ordering + tie-break key). */
  id: string;
  name?: string;
  /** "Berlaku kelipatan". */
  repeat: boolean;
  syarat: SyaratRow[];
  hasil: { items: SyaratHasilItemRef[]; reward_qty?: number; discount: HasilDiscount };
  /** Set by OWNER later; only EXPOSED as below_hpp_waiver, never enforced here. */
  allow_below_hpp?: boolean;
};

export type SyaratHasilCartLine = {
  /** Identity + tie-break. Defaults to the array index. Must be a unique safe integer. */
  source_position?: number;
  item_id: string;
  unit: string;
  qty: number;
  /** Official normal price per unit (integer rupiah). */
  unit_price: number;
  /**
   * R1: what the customer is actually charged for the WHOLE line (integer rupiah >= 0): qty x harga minus the line's manual/item
   * discount, before cart-level voucher/points and before this promo's own reward discount. The `nilai` syarat counts the line at
   * min(qty x unit_price, charged). Absent -> qty x unit_price; invalid (negative, fractional, NaN, beyond 2^53) -> 0.
   */
  charged?: number;
  /** Caller proves official price/faktor/stock evidence. Absent or false -> the line never takes part (fail closed, e.g. clinic). */
  evidence_ok?: boolean;
  manual_discount?: boolean;
  /** Units of this line already claimed by another mechanism (e.g. the Bolt 2/6 quantity_pool). Integer 0..qty. */
  units_claimed_elsewhere?: number;
};

export type SyaratHasilOptions = {
  /** Cashier override: this promo claims FIRST. Not applied -> reported in `forced` (caller must fail closed). */
  forced_promo_id?: string | null;
  /** Cashier cancel: these promos are not applied (still reported in `alternatives`). */
  excluded_promo_ids?: readonly string[];
  /** Keep every line under at most ONE promo (matches the single promo_id of sale_items until the DB changes). Default false. */
  one_promo_per_line?: boolean;
  /** Compute `alternatives` (default true). Costs no extra run when the best-of search is on (the runs are shared). */
  alternatives?: boolean;
  /**
   * Conflict resolution when NO promo is forced. "best_of" (default): plain greedy-by-savings AND every applicable promo
   * forced first (at most SH_MAX_FORCED_CANDIDATES), keep the run with the biggest total (ties: greedy, then smaller id).
   * "greedy": the old single pass (fast path / baseline for tests). Ignored when `forced_promo_id` is given.
   */
  conflict_strategy?: "best_of" | "greedy";
};

export type SyaratHasilExcludedReason =
  | "invalid_qty"
  | "invalid_price"
  | "invalid_item"
  | "invalid_claimed_units"
  | "manual_discount"
  | "no_evidence"
  /** qty * unit_price beyond 2^53: the amount cannot be represented, so the line never takes part (strict entry throws SH_OVERFLOW instead). */
  | "invalid_amount";

/** What one promo did on one line: enough to persist a per-line snapshot. */
export type SyaratHasilLineClaim = {
  promo_id: string;
  /** Sets the promo consumed in total (same on all of its lines). */
  sets_consumed: number;
  syarat_units: number;
  hasil_units: number;
  /** 0 on a syarat-only line. */
  discount_per_unit: number;
  discount: number;
};

/**
 * Every input line comes back. Malformed qty/price -> gross/net are `null` (never a fabricated 0).
 * Excluded but valued lines (manual discount, no evidence, ...) have net = gross.
 */
export type SyaratHasilLineResult = {
  source_position: number;
  item_id: string;
  unit: string;
  qty: number;
  unit_price: number;
  excluded_reason: SyaratHasilExcludedReason | null;
  gross: number | null;
  discount: number;
  net: number | null;
  claims: SyaratHasilLineClaim[];
  /** True when a promo with allow_below_hpp discounted reward units on this line. Must not stack with voucher/points/total discount. */
  below_hpp_waiver: boolean;
};

export type SyaratHasilClaim = {
  promo_id: string;
  promo_name: string | null;
  /** Sets the syarat allowed at the moment this promo was applied (1 without repeat; saturated at 2^53-1). */
  sets_available: number;
  /** Sets actually consumed = ceil(grants / reward_qty). */
  sets_consumed: number;
  /** Reward units discounted. */
  grants: number;
  syarat_units: { source_position: number; units: number }[];
  hasil_units: { source_position: number; units: number; discount_per_unit: number; discount: number }[];
  discount_total: number;
  /** What this promo would save on the untouched cart (for the cashier UI). */
  standalone_savings: number;
  below_hpp_waiver: boolean;
};

export type SyaratHasilAlternative = {
  promo_id: string;
  /** excluded (cashier cancelled), applied, conflict_lost (applicable alone but nothing left), not_applicable (saves 0 even alone). */
  status: "applied" | "conflict_lost" | "not_applicable" | "excluded";
  /** Applied but with less than its standalone savings (partly blocked by a winner). */
  reduced: boolean;
  standalone_savings: number;
  applied_discount: number;
  /** Total cart discount if THIS promo were forced primary (same exclusions otherwise). */
  total_if_forced: number;
  delta_vs_current: number;
  /** Applied promos that use the same units. */
  conflicts_with: string[];
};

export type SyaratHasilForced = {
  promo_id: string;
  applied: boolean;
  code: "SH_FORCED_NOT_FOUND" | "SH_FORCED_SKIPPED" | "SH_FORCED_NOT_APPLICABLE" | "SH_FORCED_EXCLUDED" | null;
};

export type SyaratHasilResult = {
  discount_total: number;
  /** In application order (the winner first). */
  claims: SyaratHasilClaim[];
  lines: SyaratHasilLineResult[];
  skipped: { promo_id: string | null; code: SyaratHasilErrorCode }[];
  /** SAFE entry only: input lines that could not be used at all (not an object / bad source_position). They are NOT in `lines`. */
  skipped_lines: { index: number; code: SyaratHasilErrorCode }[];
  alternatives: SyaratHasilAlternative[];
  forced: SyaratHasilForced | null;
};

export type SyaratHasilValidation = { ok: true } | { ok: false; code: SyaratHasilErrorCode; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const ZERO = BigInt(0), ONE = BigInt(1), TWO = BigInt(2), HUNDRED = BigInt(100), FIFTY = BigInt(50);
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const num = (v: bigint): number => {
  if (v > SAFE || v < -SAFE) throw new SyaratHasilError("SH_OVERFLOW", "Nilai promo melebihi batas bilangan bulat aman");
  return Number(v);
};
const sat = (v: bigint): number => (v > SAFE ? Number.MAX_SAFE_INTEGER : Number(v));
const badInput = (message: string) => new SyaratHasilError("SH_BAD_INPUT", message);
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const keyOf = (item_id: string, unit: string) => `${item_id}\u0000${unit}`;
const minBig = (a: bigint, b: bigint) => (a < b ? a : b);

// ---------------------------------------------------------------------------------------------
// Definition validation
// ---------------------------------------------------------------------------------------------

const DEF_KEYS = new Set(["id", "name", "repeat", "syarat", "hasil", "allow_below_hpp"]);
const HASIL_KEYS = new Set(["items", "reward_qty", "discount"]);

function onlyKeys(o: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(o).every((k) => allowed.has(k));
}

function validateItemRefs(items: unknown, label: string, max: number, emptyCode: SyaratHasilErrorCode): SyaratHasilValidation {
  const fail = (code: SyaratHasilErrorCode, message: string): SyaratHasilValidation => ({ ok: false, code, message });
  if (!Array.isArray(items) || items.length === 0) return fail(emptyCode, `${label}: daftar barang kosong`);
  if (items.length > max) return fail("SH_TOO_LARGE", `${label}: maksimal ${max} barang`);
  const seen = new Set<string>();
  for (const it of items as unknown[]) {
    if (!isRecord(it) || !isText(it.item_id) || !isText(it.unit) || Object.keys(it).some((k) => k !== "item_id" && k !== "unit")) {
      return fail("SH_ROW_INVALID", `${label}: barang tidak valid`);
    }
    const k = keyOf(it.item_id, it.unit);
    if (seen.has(k)) return fail("SH_ROW_INVALID", `${label}: barang + satuan dobel`);
    seen.add(k);
  }
  return { ok: true };
}

export function validateSyaratHasilDef(def: unknown): SyaratHasilValidation {
  const fail = (code: SyaratHasilErrorCode, message: string): SyaratHasilValidation => ({ ok: false, code, message });
  if (!isRecord(def)) return fail("SH_BAD_INPUT", "Promo bukan objek");
  if (!isText(def.id)) return fail("SH_BAD_INPUT", "Promo harus punya id");
  if (typeof def.repeat !== "boolean") return fail("SH_BAD_INPUT", "repeat harus boolean");
  if (!onlyKeys(def, DEF_KEYS)) return fail("SH_BAD_INPUT", "Kunci promo tidak dikenal");
  if (def.name !== undefined && typeof def.name !== "string") return fail("SH_BAD_INPUT", "name harus teks");
  if (def.allow_below_hpp !== undefined && typeof def.allow_below_hpp !== "boolean") return fail("SH_BAD_INPUT", "allow_below_hpp harus boolean");

  if (!Array.isArray(def.syarat) || def.syarat.length === 0) return fail("SH_EMPTY_SYARAT", "Promo tanpa syarat");
  if (def.syarat.length > SH_MAX_SYARAT_ROWS) return fail("SH_TOO_LARGE", `Syarat maksimal ${SH_MAX_SYARAT_ROWS} baris`);
  for (const row of def.syarat as unknown[]) {
    if (!isRecord(row)) return fail("SH_ROW_INVALID", "Baris syarat tidak valid");
    if (row.kind === "qty") {
      if (Object.keys(row).some((k) => k !== "kind" && k !== "min" && k !== "items")) return fail("SH_ROW_INVALID", "Baris syarat punya kunci tak dikenal");
      if (!isInt(row.min, 1, SH_MAX_QTY_MIN)) return fail("SH_ROW_INVALID", "Kuantitas minimum harus bilangan bulat 1..99.999");
      const v = validateItemRefs(row.items, "Syarat", SH_MAX_ROW_ITEMS, "SH_ROW_INVALID");
      if (!v.ok) return v;
    } else if (row.kind === "nilai") {
      if (Object.keys(row).some((k) => k !== "kind" && k !== "min")) return fail("SH_ROW_INVALID", "Nilai belanja dihitung atas seluruh keranjang, tanpa daftar barang");
      if (!isInt(row.min, 1, SH_MAX_MONEY)) return fail("SH_ROW_INVALID", "Nilai minimum harus bilangan bulat 1..99.999.999");
    } else return fail("SH_ROW_INVALID", "Jenis syarat tidak dikenal");
  }

  const hasil = def.hasil;
  if (!isRecord(hasil)) return fail("SH_EMPTY_HASIL", "Promo tanpa hasil");
  if (!Array.isArray(hasil.items) || hasil.items.length === 0) return fail("SH_EMPTY_HASIL", "Hasil tanpa barang");
  if (hasil.items.length > SH_MAX_HASIL_ITEMS) return fail("SH_TOO_LARGE", `Barang hasil maksimal ${SH_MAX_HASIL_ITEMS}`);
  const hv = validateItemRefs(hasil.items, "Hasil", SH_MAX_HASIL_ITEMS, "SH_EMPTY_HASIL");
  if (!hv.ok) return hv;
  if (!onlyKeys(hasil, HASIL_KEYS)) return fail("SH_BAD_INPUT", "Kunci hasil tidak dikenal");
  if (hasil.reward_qty !== undefined && !isInt(hasil.reward_qty, 1, SH_MAX_REWARD_QTY)) return fail("SH_DISCOUNT_INVALID", "Jumlah barang hasil harus bilangan bulat 1..999");
  const d = hasil.discount;
  if (!isRecord(d)) return fail("SH_DISCOUNT_INVALID", "Diskon hasil tidak valid");
  if (d.type === "nominal") {
    if (Object.keys(d).some((k) => k !== "type" && k !== "value" && !(k === "max_amount" && d[k] === undefined) ) || !isInt(d.value, 1, SH_MAX_MONEY)) {
      return fail("SH_DISCOUNT_INVALID", "Diskon nominal harus bilangan bulat > 0 tanpa maksimum diskon");
    }
  } else if (d.type === "percent") {
    if (Object.keys(d).some((k) => k !== "type" && k !== "value" && k !== "max_amount") || !isInt(d.value, 1, 100)) {
      return fail("SH_DISCOUNT_INVALID", "Diskon persen harus bilangan bulat 1..100");
    }
    if (d.max_amount !== undefined && !isInt(d.max_amount, 1, SH_MAX_MONEY)) return fail("SH_DISCOUNT_INVALID", "Maksimum diskon harus bilangan bulat > 0");
  } else return fail("SH_DISCOUNT_INVALID", "Jenis diskon tidak dikenal");
  return { ok: true };
}

export function assertValidSyaratHasilDef(def: unknown): asserts def is SyaratHasilDef {
  const v = validateSyaratHasilDef(def);
  if (!v.ok) throw new SyaratHasilError(v.code, v.message);
}

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

type Line = {
  pos: number; src: SyaratHasilCartLine; reason: SyaratHasilExcludedReason | null;
  computable: boolean; qty: bigint; price: bigint; key: string;
  /** Units a promo may use at the start: qty - claimed elsewhere, 0 when the line is excluded. */
  base: bigint;
  gross: bigint | null;
  /** R1: the amount this line contributes to a `nilai` syarat: min(gross, charged), 0 for absurd qty / no price / invalid charged. */
  nilai: bigint;
  /** R5: effective charged amount (charged absent -> gross; invalid -> 0) so the nilai can be recomputed once discounts sit on the line. */
  chg: bigint;
};

/** R5: what a line counts toward a `nilai` syarat once `d` rupiah of promo discount sits on it (the database formula: min(official gross, qty x harga - d), never below 0). */
function nilaiAfter(l: Line, d: bigint): bigint {
  if (l.nilai === ZERO) return ZERO;
  const v = minBig(l.gross as bigint, l.chg - d);
  return v > ZERO ? v : ZERO;
}

function prepareLines(lines: unknown, strict: boolean): { lines: Line[]; skippedLines: SyaratHasilResult["skipped_lines"] } {
  if (!Array.isArray(lines)) throw badInput("lines harus berupa array");
  if (lines.length > SH_MAX_LINES) throw new SyaratHasilError("SH_TOO_LARGE", `Maksimal ${SH_MAX_LINES} baris keranjang`);
  const seen = new Set<number>();
  const skippedLines: SyaratHasilResult["skipped_lines"] = [];
  const out: Line[] = [];
  (lines as unknown[]).forEach((raw, index) => {
    if (!isRecord(raw)) {
      if (strict) throw badInput(`baris ${index} bukan objek`);
      skippedLines.push({ index, code: "SH_BAD_INPUT" });
      return;
    }
    const src = raw as unknown as SyaratHasilCartLine;
    const pos = src.source_position === undefined ? index : src.source_position;
    if (!Number.isSafeInteger(pos)) {
      if (strict) throw new SyaratHasilError("SH_LINE_POSITION_INVALID", "source_position harus bilangan bulat");
      skippedLines.push({ index, code: "SH_LINE_POSITION_INVALID" });
      return;
    }
    // identity ambiguity is a caller-contract violation in BOTH entries (no safe way to pick a line)
    if (seen.has(pos)) throw new SyaratHasilError("SH_LINE_POSITION_DUPLICATE", `source_position ${pos} dipakai dua baris`);
    seen.add(pos);
    const qtyOk = isInt(src.qty, 1, Number.MAX_SAFE_INTEGER), priceOk = isInt(src.unit_price, 0, Number.MAX_SAFE_INTEGER);
    let amountOk = true;
    if (qtyOk && priceOk && BigInt(src.qty) * BigInt(src.unit_price) > SAFE) {
      if (strict) throw new SyaratHasilError("SH_OVERFLOW", "Total baris melebihi batas bilangan bulat aman"); // a LINE beyond 2^53 cannot be represented: refuse, never fabricate
      amountOk = false;
    }
    const claimedOk = src.units_claimed_elsewhere === undefined || (qtyOk && isInt(src.units_claimed_elsewhere, 0, src.qty));
    const reason: SyaratHasilExcludedReason | null = !qtyOk ? "invalid_qty" : !priceOk ? "invalid_price" : !amountOk ? "invalid_amount"
      : !(isText(src.item_id) && isText(src.unit)) ? "invalid_item" : !claimedOk ? "invalid_claimed_units"
      : src.manual_discount === true ? "manual_discount" : src.evidence_ok !== true ? "no_evidence" : null;
    const computable = qtyOk && priceOk && amountOk;
    const qty = computable ? BigInt(src.qty) : ZERO, price = computable ? BigInt(src.unit_price) : ZERO;
    const gross = computable ? qty * price : null;
    const claimed = reason === null && src.units_claimed_elsewhere !== undefined ? BigInt(src.units_claimed_elsewhere) : ZERO;
    // R1: nilai counts min(qty x official price, actually charged); absurd quantities and invalid charged amounts count 0
    const chg = !computable ? ZERO : src.charged === undefined ? (gross as bigint) : isInt(src.charged, 0, Number.MAX_SAFE_INTEGER) ? BigInt(src.charged) : ZERO;
    const nilai = !computable || qty >= BigInt(SH_NILAI_MAX_LINE_QTY) ? ZERO : minBig(gross as bigint, chg);
    out.push({
      pos, src, reason, computable, qty, price, gross, nilai, chg, key: keyOf(String(src.item_id), String(src.unit)),
      base: reason === null ? qty - claimed : ZERO,
    });
  });
  return { lines: out.sort((a, b) => a.pos - b.pos), skippedLines };
}

// ---------------------------------------------------------------------------------------------
// One promo: plan (pure, non-committing) and commit
// ---------------------------------------------------------------------------------------------

type PrepRow = { kind: "qty"; min: bigint; pool: number[] } | { kind: "nilai"; min: bigint };
type Prep = {
  def: SyaratHasilDef; id: string; rows: PrepRow[]; rq: bigint; repeat: boolean;
  /** reward candidate line indexes ordered by (discount per unit, source position, item id) */
  rewards: number[]; dpu: Map<number, bigint>;
  /** line index -> bitmask of the qty rows (by position in `rows`) whose pool contains the line */
  rowMask: Map<number, number>;
  /** Every line this promo's plan reads (syarat pools + reward candidates): a cached plan stays valid until one of them is touched. */
  deps: number[];
  /** R5: the promo has a `nilai` row: its plan depends on the whole-cart state, not only on its own lines. */
  hasNilai: boolean;
  /** 1 when the line is a reward candidate (dense, by line index) */
  rewardFlag: Uint8Array;
  /** row mask per line (dense, by line index) */
  maskOf: Int32Array;
  /** is line a a better syarat unit to spend than line b (equal rows served): higher discount per unit, then position, then item id */
  betterCost: (a: number, b: number) => boolean;
  /** Lines in a qty pool that are NOT reward candidates: reserving them costs no reward unit (source position order). */
  freeLines: number[];
  /** Reward-candidate lines in a qty pool, grouped by row mask, each group ordered (dpu DESC, source position, item id). */
  costGroups: { mask: number; lines: number[] }[];
};
type State = {
  avail: bigint[]; owner: (string | null)[]; lineClaims: LineRec[][]; total: bigint;
  /** R5: promo discount committed per line, the nilai the committed discounts removed from the cart, and `need` = the SHARED spend the
   *  committed promos already consumed (sum of sets x largest nilai row over the committed promos; ZERO = no committed nilai promo). */
  disc: bigint[]; loss: bigint; need: bigint;
  /** commit counter, and per line the commit number that last touched it (plan cache invalidation) */
  clock: number; stamp: number[];
};
type LineRec = { promo_id: string; sets: bigint; syarat: bigint; hasil: bigint; dpu: bigint; discount: bigint; allow: boolean };
type Plan = {
  prep: Prep; sets_available: bigint; sets: bigint; grants: bigint; total: bigint;
  /** R5: nilai this plan's reward discounts remove from the cart, and the shared spend consumed in total once this plan is committed. */
  loss: bigint; needAfter: bigint;
  reserve: Map<number, bigint>; rewards: { i: number; units: bigint; dpu: bigint; discount: bigint }[];
};

function unitDiscount(d: HasilDiscount, price: bigint): bigint {
  if (price <= ONE) return ZERO;
  let raw = d.type === "nominal" ? BigInt(d.value) : (price * BigInt(d.value) + FIFTY) / HUNDRED; // half-up, integer only
  if (d.type === "percent" && d.max_amount !== undefined) raw = minBig(raw, BigInt(d.max_amount));
  return minBig(raw, price - ONE); // reward net stays >= 1
}

function prepare(def: SyaratHasilDef, lines: Line[]): Prep {
  const rows: PrepRow[] = def.syarat.map((r) => {
    if (r.kind === "nilai") return { kind: "nilai", min: BigInt(r.min) };
    const keys = new Set(r.items.map((x) => keyOf(x.item_id, x.unit)));
    return { kind: "qty", min: BigInt(r.min), pool: lines.flatMap((l, i) => (l.reason === null && keys.has(l.key) ? [i] : [])) };
  });
  const hasilKeys = new Set(def.hasil.items.map((x) => keyOf(x.item_id, x.unit)));
  const dpu = new Map<number, bigint>();
  lines.forEach((l, i) => {
    if (l.reason !== null || !hasilKeys.has(l.key)) return;
    const d = unitDiscount(def.hasil.discount, l.price);
    if (d > ZERO) dpu.set(i, d);
  });
  const rewards = [...dpu.keys()].sort((a, b) => {
    const da = dpu.get(a) as bigint, db = dpu.get(b) as bigint;
    return da < db ? -1 : da > db ? 1 : lines[a].pos - lines[b].pos || byCodeUnit(lines[a].src.item_id, lines[b].src.item_id);
  });
  const rowMask = new Map<number, number>();
  rows.forEach((row, j) => { if (row.kind === "qty") for (const i of row.pool) rowMask.set(i, (rowMask.get(i) ?? 0) | (1 << j)); });
  const union = [...rowMask.keys()].sort((a, b) => a - b);
  const freeLines = union.filter((i) => !dpu.has(i));
  const groups = new Map<number, number[]>();
  for (const i of union) if (dpu.has(i)) { const m = rowMask.get(i) as number; (groups.get(m) ?? groups.set(m, []).get(m) as number[]).push(i); }
  const rank = (a: number, b: number): number => {
    const da = dpu.get(a) as bigint, db = dpu.get(b) as bigint;
    return da > db ? -1 : da < db ? 1 : lines[a].pos - lines[b].pos || byCodeUnit(lines[a].src.item_id, lines[b].src.item_id);
  };
  const costGroups = [...groups].sort((x, y) => x[0] - y[0]).map(([mask, ls]) => ({ mask, lines: ls.sort(rank) }));
  const deps = [...new Set([...union, ...rewards])].sort((x, y) => x - y);
  const rewardFlag = new Uint8Array(lines.length), maskOf = new Int32Array(lines.length);
  for (const i of dpu.keys()) rewardFlag[i] = 1;
  for (const [i, m] of rowMask) maskOf[i] = m;
  const betterCost = (a: number, b: number): boolean => rank(a, b) < 0;
  return { def, id: def.id, rows, hasNilai: rows.some((r) => r.kind === "nilai"), rq: BigInt(def.hasil.reward_qty ?? 1), repeat: def.repeat, rewards, dpu, rowMask, freeLines, costGroups, deps, rewardFlag, maskOf, betterCost };
}

function freshState(lines: Line[]): State {
  return { avail: lines.map((l) => l.base), owner: lines.map(() => null), lineClaims: lines.map(() => []), total: ZERO, disc: lines.map(() => ZERO), loss: ZERO, need: ZERO, clock: 0, stamp: lines.map(() => 0) };
}

function plan(p: Prep, lines: Line[], st: State, cartSub: bigint, onePerLine: boolean): Plan | null {
  const av = (i: number): bigint => (onePerLine && st.owner[i] !== null && st.owner[i] !== p.id ? ZERO : st.avail[i]);

  // R5: the whole-cart value is what the customer is charged AFTER the discounts committed so far.
  // SHARED SPEND (Andri 11 Nov): the `nilai` syarat is ONE pool of money per receipt. What the committed promos already consumed
  // (st.need = sum of sets x min) cannot satisfy another promo, so a nilai row only sees the spend that is still free.
  const net0 = cartSub - st.loss;
  const freeSpend = net0 > st.need ? net0 - st.need : ZERO;
  // sets each row allows, AND-ed
  let maxSets: bigint | null = null;
  for (const row of p.rows) {
    const met = row.kind === "nilai" ? freeSpend : row.pool.reduce((s, i) => s + av(i), ZERO);
    const n = met / row.min;
    if (n === ZERO) return null;
    if (maxSets === null || n < maxSets) maxSets = n;
  }
  const available = maxSets as bigint;
  const N = p.repeat ? available : ONE;

  // Reserve the syarat units for `a` sets so that as many REWARD units as possible stay free (B1).
  //  1. Lines that cannot be a reward ("free" lines) first: rows in order, earliest source position first, units already
  //     reserved by an earlier row of THIS promo are re-used before new ones are taken. They cost nothing.
  //  2. What is still missing is covered with reward-candidate lines, one unit costing one potential reward:
  //     repeatedly the line that serves the MOST still-unmet rows (a unit counts for every row of its pool), ties ->
  //     HIGHEST discount per unit first (the cheaper reward units stay free; the reward pick below takes the lowest discount
  //     first, so among all assignments granting the maximum number of reward units the customer gets the LOWEST discount:
  //     same margin-protecting stance as the approved "lowest discount first" reward pick), then source position, item id.
  //  3. Prune: drop units that are no longer needed (reward-candidate lines first, latest first).
  // Result: the number of reward units left free is the maximum over all valid reservations whenever the rows
  // overlap in a chain/laminar way (verified against a brute-force oracle for up to 3 qty rows); the choice is deterministic.
  const qtyRows: number[] = [];
  p.rows.forEach((row, j) => { if (row.kind === "qty") qtyRows.push(j); });
  const avl: bigint[] = new Array<bigint>(lines.length); // availability of the lines this promo reads
  for (const i of p.deps) avl[i] = av(i);
  const reserveFor = (a: bigint): bigint[] => {
    const rv = new Array<bigint>(lines.length); // units reserved per line (dense; only p.deps entries are meaningful)
    for (const i of p.deps) rv[i] = ZERO;
    for (const j of qtyRows) {
      const row = p.rows[j] as Extract<PrepRow, { kind: "qty" }>;
      let extra = a * row.min;
      for (const i of row.pool) extra -= rv[i];
      if (extra <= ZERO) continue;
      for (const i of row.pool) {
        if (p.rewardFlag[i] === 1) continue;
        const free = avl[i] - rv[i];
        if (free <= ZERO) continue;
        const take = free < extra ? free : extra;
        rv[i] += take;
        extra -= take;
        if (extra === ZERO) break;
      }
    }
    const orderAll: number[] = []; // reward-candidate lines taken as syarat units, in the order taken
    if (p.costGroups.length > 0) { // reward-candidate lines sit in a qty pool: cover what is still missing, cheapest in reward units
      const deficit: bigint[] = p.rows.map(() => ZERO);
      let unmet = 0;
      for (const j of qtyRows) {
        const row = p.rows[j] as Extract<PrepRow, { kind: "qty" }>;
        let d = a * row.min;
        for (const i of row.pool) d -= rv[i];
        if (d > ZERO) { deficit[j] = d; unmet |= 1 << j; }
      }
      const order: number[] = []; // reward-candidate lines in the order they were taken (for pruning)
      const ptr = p.costGroups.map(() => 0);
      while (unmet !== 0) {
        let bestG = -1, bestScore = 0, bestLine = -1;
        for (let gi = 0; gi < p.costGroups.length; gi++) {
          const g = p.costGroups[gi];
          if ((g.mask & unmet) === 0) continue;
          while (ptr[gi] < g.lines.length && avl[g.lines[ptr[gi]]] - rv[g.lines[ptr[gi]]] <= ZERO) ptr[gi]++;
          if (ptr[gi] >= g.lines.length) continue;
          let score = 0;
          for (let m = g.mask & unmet; m; m &= m - 1) score++;
          const line = g.lines[ptr[gi]];
          if (bestG < 0 || score > bestScore || (score === bestScore && p.betterCost(line, bestLine))) { bestG = gi; bestScore = score; bestLine = line; }
        }
        if (bestG < 0) break; // cannot happen when `a` <= sets available, kept as a guard
        const mask = p.maskOf[bestLine];
        let t = avl[bestLine] - rv[bestLine];
        for (const j of qtyRows) if ((mask >> j & 1) && deficit[j] > ZERO && deficit[j] < t) t = deficit[j];
        rv[bestLine] += t;
        if (!order.includes(bestLine)) order.push(bestLine);
        for (const j of qtyRows) if ((mask >> j & 1) && deficit[j] > ZERO) { deficit[j] -= t; if (deficit[j] <= ZERO) unmet &= ~(1 << j); }
      }
      for (const i of order) orderAll.push(i);
    }
    // prune: release surplus coverage (reward-candidate lines first, latest first; then free lines, latest first)
    const surplus = qtyRows.map((j) => {
      const row = p.rows[j] as Extract<PrepRow, { kind: "qty" }>;
      let c = ZERO;
      for (const i of row.pool) c += rv[i];
      return c - a * row.min;
    });
    const prune = (i: number) => {
      const have = rv[i];
      if (have <= ZERO) return;
      const mask = p.maskOf[i];
      let rem = have;
      qtyRows.forEach((j, k) => { if ((mask >> j & 1) && surplus[k] < rem) rem = surplus[k]; });
      if (rem <= ZERO) return;
      qtyRows.forEach((j, k) => { if (mask >> j & 1) surplus[k] -= rem; });
      rv[i] = have - rem;
    };
    for (let k = orderAll.length - 1; k >= 0; k--) prune(orderAll[k]);
    for (let k = p.freeLines.length - 1; k >= 0; k--) prune(p.freeLines[k]);
    return rv;
  };
  const rewardAvail = (rv: bigint[]): bigint => { let t = ZERO; for (const i of p.rewards) t += avl[i] - rv[i]; return t; };
  const reserved = new Map<bigint, bigint[]>(); // memo: the search probes few distinct set counts
  const reserveMemo = (a: bigint): bigint[] => { let r = reserved.get(a); if (!r) { r = reserveFor(a); reserved.set(a, r); } return r; };
  const rewardAt = (a: bigint): bigint => rewardAvail(reserveMemo(a));

  // Largest a in [0, N] with a*rq <= reward units left after reserving a sets (monotone: true then false).
  // slack(a) = rewardAt(a) - a*rq is piecewise linear and falling, so: probe N first (plenty of rewards -> done), then
  // alternate a linear interpolation step with a plain bisection step (log2(N) probes worst case, 1-4 for real carts).
  let lo = ZERO, hi = N;
  if (p.costGroups.length === 0) {
    lo = minBig(N, rewardAt(ZERO) / p.rq); // pools that do not overlap the reward lines never cost a reward unit
  } else if (N > ZERO) {
    const slackN = rewardAt(N) - N * p.rq;
    if (slackN >= ZERO) lo = N;
    else {
      let slackLo = rewardAt(ZERO), slackHiPlus = slackN; // slack at lo (>= 0) and at hi + 1 (< 0)
      hi = N - ONE;
      for (let step = 0; lo < hi; step++) {
        let x = (lo + hi + ONE) / TWO;
        if (step % 2 === 0) {
          x = lo + (slackLo * (hi + ONE - lo)) / (slackLo - slackHiPlus);
          if (x <= lo) x = lo + ONE;
          if (x > hi) x = hi;
        }
        const sl = rewardAt(x) - x * p.rq;
        if (sl >= ZERO) { lo = x; slackLo = sl; } else { hi = x - ONE; slackHiPlus = sl; }
      }
    }
  }
  let a = lo;
  let grants = minBig(a * p.rq, rewardAt(a));
  if (a < N) {
    const next = minBig((a + ONE) * p.rq, rewardAt(a + ONE));
    if (next > grants) { a = a + ONE; grants = next; }
  }
  if (grants <= ZERO) return null;

  // Pick reward units for `g` grants (lowest discount per unit first, p.rewards is pre-sorted) on the units left after reserving
  // only what those grants need, and measure what they take away from the whole-cart value (R5).
  type Mat = { g: bigint; s: bigint; rv: bigint[]; rewards: Plan["rewards"]; total: bigint; loss: bigint };
  const materialize = (g: bigint): Mat => {
    const s = (g + p.rq - ONE) / p.rq; // reserve only what the granted reward needs
    const rv = reserveMemo(s);
    const rewards: Plan["rewards"] = [];
    let left = g, total = ZERO, loss = ZERO;
    for (const i of p.rewards) {
      if (left === ZERO) break;
      const free = avl[i] - rv[i];
      if (free <= ZERO) continue;
      const units = minBig(free, left);
      const dpu = p.dpu.get(i) as bigint;
      const discount = units * dpu;
      rewards.push({ i, units, dpu, discount });
      total += discount;
      loss += nilaiAfter(lines[i], st.disc[i]) - nilaiAfter(lines[i], st.disc[i] + discount);
      left -= units;
    }
    return { g, s, rv, rewards, total, loss };
  };
  // The spend ONE set of this promo consumes: its largest nilai row (rows are AND-ed over the same cart money, so the strictest one decides).
  const setSpend = p.rows.reduce((mx, r) => (r.kind === "nilai" && r.min > mx ? r.min : mx), ZERO);
  // R5 + shared spend: after its own reward discount is taken, does the money still paid cover EVERY committed set AND this plan's sets?
  const fit = (m: Mat): { ok: boolean; needAfter: bigint } => {
    const needAfter = st.need + m.s * setSpend;
    return { ok: net0 - m.loss >= needAfter, needAfter };
  };
  let m = materialize(grants);
  let f = fit(m);
  if (!f.ok) {
    // Largest set count x in [1, a-1] whose own discount still fits (grants only grow with x, so fitting is monotone: true then false).
    const gAt = (x: bigint): bigint => minBig(x * p.rq, rewardAt(x));
    let lo2 = ZERO, hi2 = a - ONE;
    while (lo2 < hi2) {
      const x = (lo2 + hi2 + ONE) / TWO;
      const g = gAt(x);
      if (g > ZERO && fit(materialize(g)).ok) lo2 = x; else hi2 = x - ONE;
    }
    if (lo2 === ZERO) return null;
    grants = gAt(lo2);
    if (grants <= ZERO) return null;
    m = materialize(grants);
    f = fit(m);
    if (!f.ok) return null; // cannot happen (checked above), kept as a guard
  }
  const setsUsed = m.s;
  const reserve = new Map<number, bigint>();
  for (const i of p.deps) if (m.rv[i] > ZERO) reserve.set(i, m.rv[i]);
  const rewards = m.rewards, total = m.total;
  // Overflow guard BEFORE anything is committed (the promo is skipped, lines untouched).
  num(total);
  num(st.total + total);
  for (const r of rewards) num(r.discount);
  return { prep: p, sets_available: N, sets: setsUsed, grants, total, loss: m.loss, needAfter: f.needAfter, reserve, rewards };
}

function commit(pl: Plan, st: State) {
  const id = pl.prep.id;
  const recs = new Map<number, LineRec>();
  const rec = (i: number): LineRec => {
    let r = recs.get(i);
    if (!r) {
      r = { promo_id: id, sets: pl.sets, syarat: ZERO, hasil: ZERO, dpu: ZERO, discount: ZERO, allow: pl.prep.def.allow_below_hpp === true };
      recs.set(i, r);
    }
    return r;
  };
  for (const [i, units] of pl.reserve) { rec(i).syarat += units; st.avail[i] -= units; }
  for (const r of pl.rewards) { const x = rec(r.i); x.hasil += r.units; x.dpu = r.dpu; x.discount += r.discount; st.avail[r.i] -= r.units; }
  for (const r of pl.rewards) st.disc[r.i] += r.discount;
  st.loss += pl.loss;
  st.need = pl.needAfter;
  st.clock++;
  for (const [i, r] of recs) { st.lineClaims[i].push(r); if (st.owner[i] === null) st.owner[i] = id; st.stamp[i] = st.clock; }
  st.total += pl.total;
}

// ---------------------------------------------------------------------------------------------
// Pipeline: forced first, then greedy by savings on the units still free
// ---------------------------------------------------------------------------------------------

type PipelineOut = { st: State; commits: Plan[]; forcedApplied: boolean; skipped: { promo_id: string; code: SyaratHasilErrorCode }[] };

function runPipeline(preps: Prep[], lines: Line[], cartSub: bigint, onePerLine: boolean, forcedId: string | null, strict: boolean, seed: ReadonlyMap<Prep, Plan>): PipelineOut {
  const st = freshState(lines);
  const commits: Plan[] = [];
  const skipped: PipelineOut["skipped"] = [];
  let remaining = [...preps].sort((x, y) => byCodeUnit(x.id, y.id));
  // A plan only reads the units of its own lines, so after a commit only promos sharing a touched line are re-planned.
  // The standalone plans (fresh state) seed the cache: every run starts without a single plan() call.
  const cache = new Map<Prep, { plan: Plan | null; at: number }>();
  for (const p of preps) { const sp = seed.get(p); if (sp !== undefined) cache.set(p, { plan: sp, at: 0 }); }
  const tryPlan = (p: Prep): Plan | null => {
    const c = cache.get(p);
    // R5: a plan with a nilai row (or planned while a nilai promo is committed) depends on the whole-cart state: valid only until the next commit
    if (c && p.deps.every((i) => st.stamp[i] <= c.at) && (!(p.hasNilai || st.need > ZERO) || c.at === st.clock)) return c.plan;
    let pl: Plan | null = null;
    try { pl = plan(p, lines, st, cartSub, onePerLine); }
    catch (e) {
      if (strict || !(e instanceof SyaratHasilError)) throw e;
      skipped.push({ promo_id: p.id, code: e.code });
      pl = null;
    }
    cache.set(p, { plan: pl, at: st.clock });
    return pl;
  };
  let forcedApplied = false;
  if (forcedId !== null) {
    const f = remaining.find((p) => p.id === forcedId);
    if (f) {
      remaining = remaining.filter((p) => p !== f);
      const pl = tryPlan(f);
      if (pl) { commit(pl, st); commits.push(pl); forcedApplied = true; }
    }
  }
  for (;;) {
    let best: Plan | null = null;
    const alive: Prep[] = [];
    for (const p of remaining) {
      const pl = tryPlan(p);
      if (!pl) continue; // free units only shrink: a promo that cannot apply now never can later
      alive.push(p);
      if (best === null || pl.total > best.total) best = pl; // ascending id order: ties keep the smaller id
    }
    remaining = alive;
    if (best === null) break;
    commit(best, st);
    commits.push(best);
    remaining = remaining.filter((p) => p !== best!.prep);
  }
  return { st, commits, forcedApplied, skipped };
}

// ---------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------

type ResolvedOptions = {
  forced: string | null; excluded: Set<string>; onePerLine: boolean; alternatives: boolean; bestOf: boolean;
  /** SAFE entry: the cashier forced a promo that is also excluded -> nothing is forced, `forced.code` reports it. */
  forcedExcluded: boolean;
};

function resolveOptions(options: unknown, strict: boolean): ResolvedOptions {
  if (options === undefined) return { forced: null, excluded: new Set(), onePerLine: false, alternatives: true, bestOf: true, forcedExcluded: false };
  if (!isRecord(options)) throw badInput("options harus berupa objek");
  const o = options;
  if (o.forced_promo_id !== undefined && o.forced_promo_id !== null && !isText(o.forced_promo_id)) throw badInput("forced_promo_id harus teks atau null");
  if (o.excluded_promo_ids !== undefined && (!Array.isArray(o.excluded_promo_ids) || o.excluded_promo_ids.some((x) => !isText(x)))) throw badInput("excluded_promo_ids harus array teks");
  if (o.one_promo_per_line !== undefined && typeof o.one_promo_per_line !== "boolean") throw badInput("one_promo_per_line harus boolean");
  if (o.alternatives !== undefined && typeof o.alternatives !== "boolean") throw badInput("alternatives harus boolean");
  if (o.conflict_strategy !== undefined && o.conflict_strategy !== "best_of" && o.conflict_strategy !== "greedy") throw badInput("conflict_strategy harus best_of atau greedy");
  const forced = (o.forced_promo_id as string | null | undefined) ?? null;
  const excluded = new Set((o.excluded_promo_ids as string[] | undefined) ?? []);
  const forcedExcluded = forced !== null && excluded.has(forced);
  if (forcedExcluded && strict) throw new SyaratHasilError("SH_FORCED_EXCLUDED", "Promo pilihan kasir tidak boleh sekaligus dikecualikan");
  return { forced, excluded, onePerLine: o.one_promo_per_line === true, alternatives: o.alternatives !== false, bestOf: o.conflict_strategy !== "greedy", forcedExcluded };
}

function calculate(rawLines: unknown, rawDefs: unknown, rawOptions: unknown, strict: boolean): SyaratHasilResult {
  const opt = resolveOptions(rawOptions, strict);
  if (!Array.isArray(rawDefs)) throw badInput("promos harus berupa array");
  if (rawDefs.length > SH_MAX_PROMOS) throw new SyaratHasilError("SH_TOO_LARGE", `Maksimal ${SH_MAX_PROMOS} promo per perhitungan`);
  const { lines, skippedLines } = prepareLines(rawLines, strict);

  const skipped: SyaratHasilResult["skipped"] = [];
  const idOf = (d: unknown): string | null => (isRecord(d) && isText(d.id) ? d.id : null);
  const idCount = new Map<string, number>();
  for (const d of rawDefs as unknown[]) { const id = idOf(d); if (id !== null) idCount.set(id, (idCount.get(id) ?? 0) + 1); }
  const known = new Set<string>(idCount.keys());
  const valid: SyaratHasilDef[] = [];
  for (const d of rawDefs as unknown[]) {
    const id = idOf(d);
    if (strict) {
      assertValidSyaratHasilDef(d);
      if ((idCount.get(id as string) ?? 0) > 1) throw new SyaratHasilError("SH_DUPLICATE_ID", `id promo dobel: ${id}`);
      valid.push(d);
      continue;
    }
    if (id === null) { skipped.push({ promo_id: null, code: "SH_BAD_INPUT" }); continue; }
    if ((idCount.get(id) ?? 0) > 1) { skipped.push({ promo_id: id, code: "SH_DUPLICATE_ID" }); continue; }
    const v = validateSyaratHasilDef(d);
    if (!v.ok) { skipped.push({ promo_id: id, code: v.code }); continue; }
    valid.push(d as SyaratHasilDef);
  }

  const cartSub = lines.reduce((s, l) => s + l.nilai, ZERO); // R1: nilai basis = sum of min(official gross, actually charged)
  const preps = valid.map((d) => prepare(d, lines));

  // Standalone plan of every promo on the untouched cart: savings for the UI, and the first filter.
  const standalone = new Map<string, Plan>();
  const live: Prep[] = [];
  for (const p of preps) {
    let pl: Plan | null = null;
    try { pl = plan(p, lines, freshState(lines), cartSub, opt.onePerLine); }
    catch (e) {
      if (strict || !(e instanceof SyaratHasilError)) throw e;
      skipped.push({ promo_id: p.id, code: e.code });
      continue;
    }
    if (pl) standalone.set(p.id, pl);
    live.push(p);
  }
  const candidates = live.filter((p) => standalone.has(p.id) && !opt.excluded.has(p.id));
  const seedFor = (ps: Prep[]): Map<Prep, Plan> => new Map(ps.map((p) => [p, standalone.get(p.id) as Plan]));

  // Conflict resolution. forced promo given -> that run only (forced claims first, the rest greedy).
  // Otherwise (G1) best-of: pure greedy vs. "each applicable promo claims first, then greedy"; the forced runs are
  // memoised because the alternatives report them as `total_if_forced`.
  const applyForced = opt.forced !== null && !opt.forcedExcluded ? opt.forced : null;
  const forcedRuns = new Map<string, PipelineOut>();
  const forcedRun = (id: string): PipelineOut => {
    let run = forcedRuns.get(id);
    if (!run) { run = runPipeline(candidates, lines, cartSub, opt.onePerLine, id, false, seedFor(candidates)); forcedRuns.set(id, run); }
    return run;
  };
  let main = runPipeline(candidates, lines, cartSub, opt.onePerLine, applyForced, strict, seedFor(candidates));
  if (applyForced === null && opt.bestOf) {
    const contenders = [...candidates]
      .sort((x, y) => {
        const dx = (standalone.get(x.id) as Plan).total, dy = (standalone.get(y.id) as Plan).total;
        return dx > dy ? -1 : dx < dy ? 1 : byCodeUnit(x.id, y.id);
      })
      .slice(0, SH_MAX_FORCED_CANDIDATES)
      .sort((x, y) => byCodeUnit(x.id, y.id));
    for (const c of contenders) {
      const run = forcedRun(c.id);
      if (strict && run.skipped.length > 0) continue; // strict never silently skips: an overflowing contender run is not a contender
      if (run.st.total > main.st.total) main = run; // strictly better only: ties keep greedy, then the smaller id
    }
  }
  for (const s of main.skipped) skipped.push(s);
  const skippedIds = new Set(skipped.map((s) => s.promo_id).filter((x): x is string => x !== null));
  // (a promo that only overflowed in a later round is reported skipped here; it was never committed)

  const st = main.st;
  const total = num(st.total);

  let forced: SyaratHasilForced | null = null;
  if (opt.forced !== null) {
    const applied = main.forcedApplied && !opt.forcedExcluded;
    const code = opt.forcedExcluded ? "SH_FORCED_EXCLUDED" : applied ? null : !known.has(opt.forced) ? "SH_FORCED_NOT_FOUND" : skippedIds.has(opt.forced) ? "SH_FORCED_SKIPPED" : "SH_FORCED_NOT_APPLICABLE";
    if (strict && code !== null) throw new SyaratHasilError(code, `Promo pilihan kasir tidak dapat dipakai: ${code}`);
    forced = { promo_id: opt.forced, applied, code };
  }

  const claims: SyaratHasilClaim[] = main.commits.map((pl) => {
    const sy = [...pl.reserve].map(([i, units]) => ({ source_position: lines[i].pos, units: num(units) })).sort((a, b) => a.source_position - b.source_position);
    const ha = pl.rewards.map((r) => ({ source_position: lines[r.i].pos, units: num(r.units), discount_per_unit: num(r.dpu), discount: num(r.discount) }))
      .sort((a, b) => a.source_position - b.source_position);
    return {
      promo_id: pl.prep.id, promo_name: pl.prep.def.name ?? null, sets_available: sat(pl.sets_available), sets_consumed: num(pl.sets), grants: num(pl.grants),
      syarat_units: sy, hasil_units: ha, discount_total: num(pl.total), standalone_savings: num((standalone.get(pl.prep.id) as Plan).total),
      below_hpp_waiver: pl.prep.def.allow_below_hpp === true,
    };
  });

  const out: SyaratHasilLineResult[] = lines.map((l, i) => {
    const recs = st.lineClaims[i];
    const discount = recs.reduce((s, r) => s + r.discount, ZERO);
    return {
      source_position: l.pos, item_id: l.src.item_id, unit: l.src.unit, qty: l.src.qty, unit_price: l.src.unit_price,
      excluded_reason: l.reason, gross: l.gross === null ? null : num(l.gross), discount: num(discount),
      net: l.gross === null ? null : num(l.gross - discount),
      claims: recs.map((r) => ({
        promo_id: r.promo_id, sets_consumed: num(r.sets), syarat_units: num(r.syarat), hasil_units: num(r.hasil),
        discount_per_unit: num(r.dpu), discount: num(r.discount),
      })),
      below_hpp_waiver: recs.some((r) => r.allow && r.hasil > ZERO && r.discount > ZERO),
    };
  });

  const alternatives: SyaratHasilAlternative[] = [];
  if (opt.alternatives) {
    const appliedBy = new Map(main.commits.map((pl) => [pl.prep.id, pl]));
    const usage = (pl: Plan): Map<number, bigint> => {
      const u = new Map<number, bigint>();
      for (const [i, n] of pl.reserve) u.set(i, (u.get(i) ?? ZERO) + n);
      for (const r of pl.rewards) u.set(r.i, (u.get(r.i) ?? ZERO) + r.units);
      return u;
    };
    for (const p of [...live].sort((x, y) => byCodeUnit(x.id, y.id))) {
      const sa = standalone.get(p.id);
      const standaloneSavings = sa ? sa.total : ZERO;
      const mine = appliedBy.get(p.id);
      const applied = mine ? mine.total : ZERO;
      const status: SyaratHasilAlternative["status"] = opt.excluded.has(p.id) ? "excluded" : mine ? "applied" : sa ? "conflict_lost" : "not_applicable";
      const reduced = !!mine && applied < standaloneSavings;
      let totalIfForced = st.total;
      if (!(applyForced === p.id && main.forcedApplied)) {
        if (!opt.excluded.has(p.id)) totalIfForced = forcedRun(p.id).st.total; // same candidate set as the main run: shared
        else {
          const ex = new Set(opt.excluded); ex.delete(p.id);
          const cands = live.filter((x) => standalone.has(x.id) && !ex.has(x.id));
          totalIfForced = runPipeline(cands, lines, cartSub, opt.onePerLine, p.id, false, seedFor(cands)).st.total;
        }
      }
      const conflicts: string[] = [];
      if (sa && (status === "conflict_lost" || status === "excluded" || reduced)) {
        const mineUse = usage(sa);
        for (const other of main.commits) {
          if (other.prep.id === p.id) continue;
          const ou = usage(other);
          const clash = [...mineUse].some(([i, n]) => ou.has(i) && (opt.onePerLine || n + (ou.get(i) as bigint) > lines[i].base));
          if (clash) conflicts.push(other.prep.id);
        }
        conflicts.sort(byCodeUnit);
      }
      alternatives.push({
        promo_id: p.id, status, reduced, standalone_savings: num(standaloneSavings), applied_discount: num(applied),
        total_if_forced: num(totalIfForced), delta_vs_current: num(totalIfForced) - total, conflicts_with: conflicts,
      });
    }
  }

  skipped.sort((a, b) => byCodeUnit(a.promo_id ?? "", b.promo_id ?? "") || byCodeUnit(a.code, b.code));
  return { discount_total: total, claims, lines: out, skipped, skipped_lines: skippedLines, alternatives, forced };
}

/**
 * CHECKOUT entry: every promo is validated and planned independently. An invalid/stale promo (bad
 * shape, duplicate id, missing id) or one that overflows is SKIPPED and reported in `skipped`; it
 * never blocks the others. Conflicts are resolved by savings (see file header), `forced_promo_id` /
 * `excluded_promo_ids` implement the cashier override. A forced promo that could not be applied is
 * reported in `forced.code`: the CALLER must then fail closed (reject checkout / reload), never
 * silently use another promo.
 *
 * Never throws for bad DATA: a null / non-object line or a non-integer source_position is left out of `lines` and listed in
 * `skipped_lines` (SH_BAD_INPUT / SH_LINE_POSITION_INVALID); a line whose qty*price exceeds 2^53 is excluded
 * (excluded_reason "invalid_amount", null gross/net); a promo that is invalid/overflows goes to `skipped`; forced + excluded on
 * the same id reports `forced.code = SH_FORCED_EXCLUDED` (nothing forced). It still throws a typed SyaratHasilError (never a raw
 * TypeError) for caller-contract violations: lines/promos/options that are not arrays/objects, SH_LINE_POSITION_DUPLICATE and
 * SH_TOO_LARGE (>2000 lines, >64 promos). Wrap the call and fail closed anyway.
 */
export function calculateSyaratHasilSafe(lines: readonly SyaratHasilCartLine[], defs: readonly SyaratHasilDef[], options: SyaratHasilOptions = {}): SyaratHasilResult {
  return calculate(lines, defs, options, false);
}

/** STRICT entry (editor preview, tests): throws on the first invalid/duplicate promo, bad line (SH_BAD_INPUT, SH_LINE_POSITION_INVALID), line overflow (SH_OVERFLOW), forced+excluded (SH_FORCED_EXCLUDED) and an inapplicable forced promo. Not for checkout. */
export function calculateSyaratHasil(lines: readonly SyaratHasilCartLine[], defs: readonly SyaratHasilDef[], options: SyaratHasilOptions = {}): SyaratHasilResult {
  return calculate(lines, defs, options, true);
}

// ---------------------------------------------------------------------------------------------
// Adapter for the later promo-hitung.ts wiring (structural type, no import)
// ---------------------------------------------------------------------------------------------

/** Same shape as `BarisKeranjang` in promo-hitung.ts. */
export type SyaratHasilCartRow = {
  item_id: string; qty: number; harga: number; satuan?: string | null; faktor?: number; officialPrice?: number;
  manualOverride?: boolean; item_discount_type?: string | null; item_discount_value?: number | null;
  /** Units of this row another mechanism (Bolt pool, legacy per_unit/package) already claimed. Server-derived; see header wiring notes. */
  unitsClaimedElsewhere?: number;
  /**
   * R1: Rupiah discount (whole line) that another mechanism already granted to this row (e.g. the Bolt pool), server-derived.
   * Like the database it only applies when the row has no manual/item discount. Never pass THIS promo's reward discount here.
   */
  promoDiscount?: number;
};

/**
 * What the customer is charged for the whole row before cart-level voucher/points: qty x harga minus the line discount, with the
 * database formulas (cashier_post_stock_atomic / promo_sh_verify_claims): manual = round(gross x value / 100) for 'percent', the value
 * itself for any other type; discount = least(greatest(manual > 0 ? manual : promoDiscount, 0), gross). Not representable / not finite -> 0.
 */
function chargedOfRow(b: SyaratHasilCartRow): number {
  const qty = b.qty, harga = b.harga;
  if (typeof qty !== "number" || typeof harga !== "number" || !Number.isFinite(qty) || !Number.isFinite(harga)) return 0;
  const gross = qty * harga;
  if (!Number.isSafeInteger(qty) || !Number.isSafeInteger(harga) || qty < 1 || harga < 0 || !Number.isSafeInteger(gross)) return 0;
  const value = b.item_discount_value === undefined || b.item_discount_value === null ? 0 : Number(b.item_discount_value);
  if (!Number.isFinite(value)) return 0;
  const manual = b.item_discount_type === "percent" ? Math.floor((gross * value) / 100 + 0.5) : value;
  const pd = b.promoDiscount === undefined ? 0 : Number(b.promoDiscount);
  if (!Number.isFinite(pd) || !Number.isFinite(manual)) return 0;
  const discount = Math.min(Math.max(manual > 0 ? manual : pd, 0), gross);
  const charged = gross - discount;
  return Number.isSafeInteger(charged) && charged >= 0 ? Math.floor(charged) : 0;
}

/**
 * BarisKeranjang[] -> engine lines (source_position = array index). Evidence = the line carries a
 * positive faktor, its unit (satuan) and the official price, and `harga` equals it; rows without
 * faktor/officialPrice (clinic) therefore never take part. The server still verifies the official
 * faktor/price against the master at finalisation (these fields are client-supplied). Manual override or an
 * item discount marks the line manual (excluded from promos). unit_price = officialPrice (normal price) whenever the row has
 * one (reward discounts are computed on it; a row without an official price falls back to harga for display only).
 * R1: `charged` = what the row is actually charged (see chargedOfRow); a row WITHOUT an official price (clinic, free text)
 * gets charged 0 so it never counts toward a nilai syarat (the database cannot verify it either). A manual override
 * (harga typed by the cashier) therefore counts at the typed harga, never at the official price.
 */
export function syaratHasilLinesFromCart(cart: readonly SyaratHasilCartRow[]): SyaratHasilCartLine[] {
  if (!Array.isArray(cart)) throw badInput("cart harus berupa array");
  return (cart as unknown[]).map((raw, index) => {
    if (!isRecord(raw)) throw badInput(`baris keranjang ${index} bukan objek`);
    const b = raw as unknown as SyaratHasilCartRow;
    const evidence = typeof b.faktor === "number" && Number.isFinite(b.faktor) && b.faktor > 0 &&
      Number.isSafeInteger(b.officialPrice) && (b.officialPrice as number) >= 0 && b.harga === b.officialPrice && isText(b.satuan);
    const hasOfficial = Number.isSafeInteger(b.officialPrice) && (b.officialPrice as number) >= 0;
    const line: SyaratHasilCartLine = {
      source_position: index, item_id: b.item_id, unit: typeof b.satuan === "string" ? b.satuan : "", qty: b.qty, unit_price: hasOfficial ? (b.officialPrice as number) : b.harga,
      charged: hasOfficial ? chargedOfRow(b) : 0,
      evidence_ok: evidence, manual_discount: b.manualOverride === true || (!!b.item_discount_type && Number(b.item_discount_value) > 0),
    };
    if (b.unitsClaimedElsewhere !== undefined) line.units_claimed_elsewhere = b.unitsClaimedElsewhere;
    return line;
  });
}
