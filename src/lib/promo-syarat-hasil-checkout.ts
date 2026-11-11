/**
 * Promo "Syarat -> Hasil" (Accurate-style bundling), STAGE 3: the checkout/cart adapter layer between the pure engine
 * (promo-syarat-hasil.ts) and the petshop cashier (kasir/checkout.ts server action + KasirClient.tsx display).
 *
 * Pure except `loadSyaratHasilKasir`. Shared by the SERVER (the numbers that are saved) and the CLIENT (the numbers that are shown).
 * Everything here is a no-op unless the caller hands in at least one definition, and definitions are only loaded when the
 * database release flag `promo_release_flags('syarat_hasil')` is ON (default OFF).
 *
 * Decisions implemented (Andri, 4 Nov 2026): a conflict with another promo (Bolt 2/6 pool, per_unit, package_total) is won by the
 * promo that saves the customer MORE (ties keep the existing promo); promos that do not conflict run together automatically; the
 * cashier can switch everything off ("tanpa promo", needs the promo_picker flag); nilai belanja = whole cart; petshop only.
 *
 * How a cart becomes claims the database verifies (see migrations 20261106510000/320000, "APP CONTRACT"):
 *  - every cart line the engine claims is SPLIT into a claimed line (syarat/hasil units only; promo_claim_id, promo_sets,
 *    promo_syarat_units, promo_hasil_units) and a plain remainder line, because a claimed line leaves the Bolt pool as a whole;
 *  - a below-HPP waiver reward goes on a PURE reward line (promo_hasil_units = qty), separate from syarat units of the same line;
 *  - the legacy engine is re-run over the PLAIN lines only, so what the Bolt pool guard recomputes in the database is what was priced;
 *  - the nilai syarat is re-verified against the FINAL charges (reward discount and legacy discounts included) before a claim is
 *    offered, exactly as promo_sh_verify_claims counts them, so a claim the database would refuse is never produced.
 * Three candidates are priced (legacy only / syarat-hasil planned knowing the legacy discounts / syarat-hasil first, legacy on the
 * rest); the largest total saving wins, ties keep the earlier one (legacy only first).
 */
import { readCompleteList } from "./checked-list";
import { PosDecimal } from "./pos-money";
import { hariIniWIB } from "./tanggal";
import {
  calculateSyaratHasilSafe, syaratHasilLinesFromCart, validateSyaratHasilDef, SH_NILAI_MAX_LINE_QTY,
  type SyaratHasilCartLine, type SyaratHasilDef, type SyaratHasilResult,
} from "./promo-syarat-hasil";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** `promos.rule->>'discount_mode' = 'syarat_hasil'`: such a promo is never a legacy (hitungPromoKeranjang) promo. */
export function isSyaratHasilRule(rule: unknown): boolean {
  return isRecord(rule) && rule.discount_mode === "syarat_hasil";
}

/** Stored promo -> engine definition. Null (promo skipped, never thrown) when the rule is not a valid definition. */
export function syaratHasilDefFromRow(row: { id: string; name?: string | null; rule: unknown }, options: { belowHppReleased: boolean }): SyaratHasilDef | null {
  try {
    if (!isSyaratHasilRule(row.rule)) return null;
    const sh = (row.rule as Record<string, unknown>).syarat_hasil;
    if (!isRecord(sh) || !Array.isArray(sh.syarat) || !isRecord(sh.hasil) || !Array.isArray(sh.hasil.items) || !isRecord(sh.hasil.discount)) return null;
    const refs = (items: unknown[]) => items.map((x) => (isRecord(x) ? { item_id: x.item_id as string, unit: x.unit as string } : x as never));
    const hasil = sh.hasil;
    const d = hasil.discount as Record<string, unknown>;
    const def: SyaratHasilDef = {
      id: row.id,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      repeat: sh.repeat as boolean,
      syarat: (sh.syarat as unknown[]).map((r) => {
        if (!isRecord(r)) return r as never;
        return r.kind === "nilai" ? { kind: "nilai", min: r.min as number } : { kind: r.kind as "qty", min: r.min as number, items: Array.isArray(r.items) ? refs(r.items) : (r.items as never) };
      }),
      hasil: {
        items: refs(hasil.items as unknown[]),
        ...(hasil.reward_qty !== undefined ? { reward_qty: hasil.reward_qty as number } : {}),
        discount: d.type === "percent"
          ? { type: "percent", value: d.value as number, ...(d.max_amount !== undefined && d.max_amount !== null ? { max_amount: d.max_amount as number } : {}) }
          : { type: d.type as "nominal", value: d.value as number },
      },
      allow_below_hpp: options.belowHppReleased && isRecord(sh.below_hpp) && sh.below_hpp.allowed === true,
    };
    return validateSyaratHasilDef(def).ok ? def : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Loader (server only): flags + active definitions for the branch
// ---------------------------------------------------------------------------------------------

export type SyaratHasilKasir = { released: boolean; pickerReleased: boolean; belowHppReleased: boolean; defs: SyaratHasilDef[] };
export const SYARAT_HASIL_OFF: SyaratHasilKasir = { released: false, pickerReleased: false, belowHppReleased: false, defs: [] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
export type PromoRow = { id: string; name: string; rule: unknown; branch_ids: string[] | null; valid_from: string | null; valid_until: string | null; auto_apply?: boolean };

async function releaseFlag(supabase: AnyClient, flag: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("promo_release_enabled", { p_flag: flag });
  if (error) {
    // the database does not have the function yet (app deployed first): the feature does not exist there -> OFF. Anything else: fail closed.
    if (error.code === "42883" || error.code === "PGRST202") return false;
    throw new Error("Status rilis promo belum dapat dibaca. Muat ulang kasir.");
  }
  return data === true;
}

/**
 * Active syarat_hasil promos of the branch, only while the DB release flag is ON. Reads the promos first: while the flag is OFF no
 * such promo can be active (the database refuses the activation), so the common case costs one list read and no RPC.
 */
export async function loadSyaratHasilKasir(supabase: AnyClient, branchId: string, preloaded?: readonly PromoRow[]): Promise<SyaratHasilKasir> {
  const wibToday = hariIniWIB();
  // `preloaded` = the page's own complete list of active promos (saves a read); only auto-apply syarat_hasil rows count either way.
  const rows = preloaded ? preloaded.filter((p) => isSyaratHasilRule(p.rule) && p.auto_apply !== false) : await readCompleteList<PromoRow>((from, to) => supabase.from("promos")
    .select("id, name, rule, branch_ids, valid_from, valid_until", { count: "exact" })
    .eq("is_active", true).eq("auto_apply", true).eq("rule->>discount_mode", "syarat_hasil").order("id").range(from, to), "Promo syarat-hasil aktif");
  const aktif = rows.filter((p) => {
    if (p.branch_ids && p.branch_ids.length > 0 && !p.branch_ids.includes(branchId)) return false;
    if (p.valid_from && wibToday < p.valid_from) return false;
    if (p.valid_until && wibToday > p.valid_until) return false;
    return isSyaratHasilRule(p.rule);
  });
  if (aktif.length === 0) return SYARAT_HASIL_OFF;
  if (!(await releaseFlag(supabase, "syarat_hasil"))) return SYARAT_HASIL_OFF;
  const [pickerReleased, belowHppReleased] = await Promise.all([releaseFlag(supabase, "promo_picker"), releaseFlag(supabase, "below_hpp")]);
  // Stage 3b: an Owner below-HPP waiver is planned only while the DB flag below_hpp is released (the TS floor honours it, see cashier-price-floor).
  const defs = aktif.flatMap((p) => { const d = syaratHasilDefFromRow(p, { belowHppReleased }); return d ? [d] : []; });
  return { released: true, pickerReleased, belowHppReleased, defs };
}

/**
 * Back-office screen (stage 4): definitions per branch, DISPLAY ONLY. Undefined when nothing applies anywhere (the screen stays the legacy one).
 * A failing read only hides the preview: checkoutSale loads its own definitions and fails closed.
 */
export async function loadSyaratHasilPerCabang(supabase: AnyClient, branchIds: readonly string[]): Promise<Record<string, SyaratHasilDef[]> | undefined> {
  const entries = await Promise.all(branchIds.map(async (id) => {
    try { return [id, (await loadSyaratHasilKasir(supabase, id)).defs] as const; }
    catch (error) { console.error("[pos/transaksi] promo syarat-hasil tidak terbaca untuk tampilan:", error); return [id, [] as SyaratHasilDef[]] as const; }
  }));
  const present = entries.filter(([, defs]) => defs.length > 0);
  return present.length > 0 ? Object.fromEntries(present) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Pure composition
// ---------------------------------------------------------------------------------------------

export type ShRow = {
  item_id: string; nama?: string; qty: number; harga: number; satuan?: string | null; faktor?: number;
  item_type?: string;
  /** items.min_sell_qty in BASE units (0/absent = no minimum). A split never leaves a plain/claimed part below it (the parts are merged back). */
  minSellBase?: number;
  /** Master price per unit BEFORE tier/negotiated reductions (branch price, else unit/base price). Absent = free text / no master. */
  officialPrice?: number;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
};
export type LegacyHit = { lineIndex: number; potongan: number; promoId: string; promoName?: string };
/** The legacy promo engine over rows; `only` = evaluate that ONE promo alone (cashier pick / alternatives). */
export type LegacyFn<T> = (rows: T[], only?: string) => LegacyHit[];
export type ShClaimMeta = { promo_id: string; sets: number; syarat_units: number; hasil_units: number; waiver: boolean };
export type ComposedRow<T> = T & { promo_discount: number; promo_id: string | null; promo_name: string | null; sh_claim?: ShClaimMeta; origin_index: number };
export type AppliedPromo = { promo_id: string; name: string | null; discount: number; kind: "syarat_hasil" | "legacy" };
export type PromoAlternative = { promo_id: string; name: string | null; kind: "syarat_hasil" | "legacy"; saving: number; applied: boolean };
export type PromoPickState = { mode: "auto" | "tanpa" | "pilih"; promo_id: string | null; ok: boolean };
export type Composed<T> = {
  rows: ComposedRow<T>[];
  /** Number of automatic promo hits (legacy hits incl. a hit of potongan 0, plus claimed syarat_hasil promos): the voucher gate `adaPromoOtomatis`. */
  hitCount: number;
  pick: PromoPickState;
  /** Every promo that would save something when made the (only) main promo; empty unless asked for. */
  alternatives: PromoAlternative[];
  /** syarat_hasil promos the caller removed (HPP guard) - echoed. */
  excluded: string[];
  strategy: "none" | "legacy" | "syarat_hasil";
  applied: AppliedPromo[];
  savings: { legacy: number; syarat_hasil: number; total: number };
  /** syarat_hasil promos that applied on their own but lost against the winning combination (less saving for the customer). */
  notApplied: { promo_id: string; name: string | null; saving: number }[];
  skipped: { promo_id: string | null; code: string }[];
};

type Part<T> = { row: T; origin: number; claim?: ShClaimMeta; discount: number; promoId: string | null; promoName: string | null };
type Candidate<T> = { parts: Part<T>[]; legacy: number; sh: number; hits: number; claimed: { promo_id: string; name: string | null; discount: number }[]; skipped: Composed<T>["skipped"] };

const numberOr0 = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function composeSyaratHasilCart<T extends ShRow>(args: {
  rows: readonly T[];
  defs: readonly SyaratHasilDef[];
  /** The existing promo engine over a set of rows (serviceLinePromos / hitungPromoKeranjang); hits refer to indexes of the rows it is given. `only` = that ONE promo alone. */
  legacy: LegacyFn<T>;
  /** "tanpa" = the cashier chose no promo at all; "pilih" = the cashier picked `pickId` as the ONLY promo (exclusive: the DB re-checks `promo_pick_exclusive`). */
  mode?: "auto" | "tanpa" | "pilih";
  pickId?: string | null;
  /** syarat_hasil promos taken out before planning (below-HPP guard); echoed in `excluded`. */
  excludedIds?: readonly string[];
  /** Legacy promos known to the screen (alternatives list). */
  legacyPromos?: readonly { id: string; name: string }[];
  withAlternatives?: boolean;
}): Composed<T> {
  const { rows, legacy, mode = "auto", pickId = null, legacyPromos = [], withAlternatives = false } = args;
  const excludedIds = [...(args.excludedIds ?? [])];
  const defs = args.defs.filter((d) => !excludedIds.includes(d.id));
  const nameOf = new Map(args.defs.map((d) => [d.id, d.name ?? null] as const));

  const legacyOver = (subset: T[], only?: string): { discount: number[]; id: (string | null)[]; name: (string | null)[]; total: number; hits: number } => {
    const discount = subset.map(() => 0), id = subset.map(() => null as string | null), name = subset.map(() => null as string | null);
    let hits = 0;
    for (const h of legacy(subset, only)) {
      if (only !== undefined && h.promoId !== only) continue;
      hits++;
      if (!Number.isInteger(h.lineIndex) || h.lineIndex < 0 || h.lineIndex >= subset.length) continue;
      discount[h.lineIndex] = h.potongan; id[h.lineIndex] = h.promoId; name[h.lineIndex] = h.promoName ?? null; // last hit wins, like the original assignment
    }
    return { discount, id, name, total: discount.reduce((s, x) => s + numberOr0(x), 0), hits };
  };

  const finish = (cand: Candidate<T>, notApplied: Composed<T>["notApplied"], pick: PromoPickState, alternatives: PromoAlternative[] = []): Composed<T> => {
    const out: ComposedRow<T>[] = cand.parts.map((p) => ({
      ...p.row, promo_discount: p.discount, promo_id: p.promoId, promo_name: p.promoName, origin_index: p.origin,
      ...(p.claim ? { sh_claim: p.claim } : {}),
    }));
    const legacyApplied = new Map<string, AppliedPromo>();
    for (const p of cand.parts) {
      if (p.claim || p.promoId === null || !(p.discount > 0)) continue;
      const cur = legacyApplied.get(p.promoId);
      if (cur) cur.discount += p.discount; else legacyApplied.set(p.promoId, { promo_id: p.promoId, name: p.promoName, discount: p.discount, kind: "legacy" });
    }
    const applied: AppliedPromo[] = [...cand.claimed.map((c) => ({ ...c, kind: "syarat_hasil" as const })), ...legacyApplied.values()];
    const strategy = cand.claimed.length > 0 ? "syarat_hasil" : cand.legacy > 0 ? "legacy" : "none";
    return { rows: out, hitCount: cand.hits, pick, alternatives, excluded: excludedIds, strategy, applied, savings: { legacy: cand.legacy, syarat_hasil: cand.sh, total: cand.legacy + cand.sh }, notApplied, skipped: cand.skipped };
  };

  const plainCandidate = (subset: T[], withLegacy: boolean, only?: string): Candidate<T> => {
    const lg = withLegacy ? legacyOver(subset, only) : null;
    return {
      parts: subset.map((row, i) => ({ row, origin: i, discount: lg ? lg.discount[i] : 0, promoId: lg ? lg.id[i] : null, promoName: lg ? lg.name[i] : null })),
      legacy: lg ? lg.total : 0, sh: 0, hits: lg ? lg.hits : 0, claimed: [], skipped: [],
    };
  };

  const autoPick: PromoPickState = { mode: "auto", promo_id: null, ok: true };
  if (mode === "tanpa") return finish(plainCandidate([...rows], false), [], { mode: "tanpa", promo_id: null, ok: true });
  const cand0 = plainCandidate([...rows], mode !== "pilih");

  // ---- engine lines for a set of rows (evidence: only Persediaan lines are syarat/reward units; every line still counts toward nilai)
  const engineLines = (subset: T[], disc: number[] | null): SyaratHasilCartLine[] =>
    syaratHasilLinesFromCart(subset.map((r, i) => ({
      item_id: r.item_id, qty: r.qty, harga: r.harga, satuan: r.satuan ?? null, faktor: r.faktor, officialPrice: r.officialPrice,
      manualOverride: numberOr0(r.item_discount_value) > 0,
      item_discount_type: r.item_discount_type ?? null, item_discount_value: r.item_discount_value ?? null,
      ...(disc && disc[i] > 0 ? { unitsClaimedElsewhere: r.qty, promoDiscount: disc[i] } : {}),
    }))).map((l, i) => (subset[i].item_type === "Persediaan" ? l : { ...l, evidence_ok: false }));

  /** The money the cart carries toward a nilai syarat, once every discount of the final rows sits on it (promo_sh_verify_claims formula). */
  const finalNilai = (parts: Part<T>[]): number => {
    const lines = syaratHasilLinesFromCart(parts.map((p) => ({
      item_id: p.row.item_id, qty: p.row.qty, harga: p.row.harga, satuan: p.row.satuan ?? null, faktor: p.row.faktor, officialPrice: p.row.officialPrice,
      manualOverride: numberOr0(p.row.item_discount_value) > 0,
      item_discount_type: p.row.item_discount_type ?? null, item_discount_value: p.row.item_discount_value ?? null,
      ...(p.discount > 0 ? { promoDiscount: p.discount } : {}),
    })));
    return lines.reduce((s, l) => {
      if (l.qty >= SH_NILAI_MAX_LINE_QTY || !Number.isSafeInteger(l.qty * l.unit_price)) return s;
      return s + Math.min(l.qty * l.unit_price, l.charged ?? l.qty * l.unit_price);
    }, 0);
  };

  /** min_sell_qty is in base units; a part of a split line must not fall below it. */
  const belowMin = (r: T, qty: number): boolean => { const m = numberOr0(r.minSellBase); return m > 0 && qty * (numberOr0(r.faktor) || 1) < m; };

  const buildFromEngine = (res: SyaratHasilResult, legacyOn: boolean): Candidate<T> | null => {
    const claimedPromos = new Map<string, { sets: number; discount: number }>();
    const parts: Part<T>[] = [];
    let invalid = false;
    rows.forEach((row, i) => {
      const lr = res.lines[i];
      const c = lr?.claims[0];
      if (!lr || lr.source_position !== i) throw new Error("engine lines out of order");
      if (!c) { parts.push({ row, origin: i, discount: 0, promoId: null, promoName: null }); return; }
      const S = c.syarat_units, H = c.hasil_units;
      const rest = new PosDecimal(row.qty).minus(S).minus(H).toNumber(); // decimal-safe (the engine only claims whole quantities, so this is an exact integer)
      const waiver = lr.below_hpp_waiver && H > 0;
      const cur = claimedPromos.get(c.promo_id) ?? { sets: c.sets_consumed, discount: 0 };
      cur.discount += c.discount; claimedPromos.set(c.promo_id, cur);
      const claimLine = (qty: number, syarat: number, hasil: number, discount: number, wv: boolean) => parts.push({
        row: { ...row, qty }, origin: i, discount, promoId: hasil > 0 && discount > 0 ? c.promo_id : null, promoName: hasil > 0 && discount > 0 ? nameOf.get(c.promo_id) ?? null : null,
        claim: { promo_id: c.promo_id, sets: c.sets_consumed, syarat_units: syarat, hasil_units: hasil, waiver: wv },
      });
      const plainLine = (qty: number) => parts.push({ row: { ...row, qty }, origin: i, discount: 0, promoId: null, promoName: null });
      if (waiver) {
        // below-HPP waiver: the reward is a PURE reward line (it can never be merged with other units, so a minimum breach drops the candidate)
        if (belowMin(row, H)) { invalid = true; return; }
        if (S === 0 || !belowMin(row, S)) {
          if (rest > 0 && belowMin(row, rest)) { invalid = true; return; }
          if (S > 0) claimLine(S, S, 0, 0, false);
          claimLine(H, 0, H, c.discount, true);
          if (rest > 0) plainLine(rest);
        } else {
          // the syarat part alone is under the minimum: it travels together with the plain units on one claim line
          if (belowMin(row, S + rest)) { invalid = true; return; }
          claimLine(S + rest, S, 0, 0, false);
          claimLine(H, 0, H, c.discount, true);
        }
        return;
      }
      if (rest > 0 && (belowMin(row, rest) || belowMin(row, S + H))) { claimLine(row.qty, S, H, c.discount, false); return; } // merged back: one claim line, units beyond S+H stay plain
      claimLine(S + H, S, H, c.discount, false);
      if (rest > 0) plainLine(rest);
    });
    if (invalid || claimedPromos.size === 0) return null;
    // legacy promos over the PLAIN lines only (a claimed line is not a Bolt-pool member in the database)
    const plain = parts.filter((p) => !p.claim);
    const lg = legacyOn ? legacyOver(plain.map((p) => p.row)) : null;
    if (lg) plain.forEach((p, k) => { p.discount = lg.discount[k]; p.promoId = lg.id[k]; p.promoName = lg.name[k]; });
    // the nilai syarat must still hold on the FINAL charges, and it is ONE pool of money for the whole receipt (Andri 11 Nov): every claimed
    // set consumes sets x (largest nilai row of its promo), and all promos together may not consume more than the money actually charged
    // (promo_sh_verify_claims enforces the same aggregate).
    const money = finalNilai(parts);
    let spendNeeded = 0;
    for (const [promoId, info] of claimedPromos) {
      const def = defs.find((d) => d.id === promoId);
      if (!def) return null;
      for (const r of def.syarat) if (r.kind === "nilai" && money < info.sets * r.min) return null;
      spendNeeded += info.sets * def.syarat.reduce((mx, r) => (r.kind === "nilai" && r.min > mx ? r.min : mx), 0);
    }
    if (money < spendNeeded) return null;
    const sh = [...claimedPromos.values()].reduce((s, x) => s + x.discount, 0);
    return {
      parts, legacy: lg ? lg.total : 0, sh, hits: (lg ? lg.hits : 0) + claimedPromos.size,
      claimed: [...claimedPromos].map(([promo_id, v]) => ({ promo_id, name: nameOf.get(promo_id) ?? null, discount: v.discount })),
      skipped: res.skipped.map((s) => ({ promo_id: s.promo_id, code: s.code })),
    };
  };

  const attempt = (disc: number[] | null, legacyOn: boolean, options: { forced_promo_id?: string; excluded_promo_ids?: string[] } = {}): { cand: Candidate<T> | null; skipped: Composed<T>["skipped"]; forcedApplied: boolean } => {
    try {
      const res = calculateSyaratHasilSafe(engineLines([...rows], disc), defs, { one_promo_per_line: true, alternatives: false, ...options });
      return { cand: buildFromEngine(res, legacyOn), skipped: res.skipped.map((s) => ({ promo_id: s.promo_id, code: s.code })), forcedApplied: res.forced?.applied === true };
    } catch {
      return { cand: null, skipped: [], forcedApplied: false }; // fail closed: the legacy result stands
    }
  };
  /** "This promo alone" (exclusive pick): syarat_hasil promo `id` claims first, every other promo and the legacy engine are off. */
  const aloneSh = (id: string) => {
    const r = attempt(null, false, { forced_promo_id: id, excluded_promo_ids: defs.filter((d) => d.id !== id).map((d) => d.id) });
    return r.forcedApplied && r.cand && r.cand.claimed.some((c) => c.promo_id === id) ? r.cand : null;
  };
  const aloneLegacy = (id: string) => { const c = plainCandidate([...rows], true, id); return c.parts.some((p) => p.promoId === id && p.discount > 0) ? c : null; };
  const alternativesFor = (best: Candidate<T>): PromoAlternative[] => {
    if (!withAlternatives) return [];
    const out: PromoAlternative[] = [];
    for (const d of defs) { const c = aloneSh(d.id); if (c && c.sh > 0) out.push({ promo_id: d.id, name: d.name ?? null, kind: "syarat_hasil", saving: c.sh, applied: best.claimed.some((x) => x.promo_id === d.id) }); }
    for (const lp of legacyPromos) { const c = aloneLegacy(lp.id); if (c) out.push({ promo_id: lp.id, name: lp.name, kind: "legacy", saving: c.legacy, applied: best.parts.some((p) => !p.claim && p.promoId === lp.id && p.discount > 0) }); }
    return out;
  };

  if (mode === "pilih") {
    const none = plainCandidate([...rows], false);
    const fail = () => finish(none, [], { mode: "pilih", promo_id: pickId, ok: false }, alternativesFor(none));
    if (!pickId) return fail();
    const cand = defs.some((d) => d.id === pickId) ? aloneSh(pickId) : aloneLegacy(pickId);
    return cand ? finish(cand, [], { mode: "pilih", promo_id: pickId, ok: true }, alternativesFor(cand)) : fail();
  }
  if (defs.length === 0) return finish(cand0, [], autoPick, alternativesFor(cand0));

  const legacyKnown = attempt(legacyOver([...rows]).discount, true); // syarat-hasil planned around the legacy discounts
  const shFirst = attempt(null, true);                              // syarat-hasil first, legacy on what is left
  const skipped = [...legacyKnown.skipped, ...shFirst.skipped].filter((s, i, all) => all.findIndex((o) => o.promo_id === s.promo_id && o.code === s.code) === i);
  const tried = [legacyKnown.cand, shFirst.cand].filter((c): c is Candidate<T> => c !== null);
  let best = cand0;
  for (const c of tried) if (c.legacy + c.sh > best.legacy + best.sh) best = c;
  const lost = tried.filter((c) => c !== best && c.claimed.length > 0).sort((a, b) => (b.legacy + b.sh) - (a.legacy + a.sh))[0];
  const notApplied = best.claimed.length > 0 || !lost ? [] : lost.claimed.map((c) => ({ promo_id: c.promo_id, name: c.name, saving: c.discount }));
  const out = finish(best, notApplied, autoPick, alternativesFor(best));
  return { ...out, skipped };
}

// ---------------------------------------------------------------------------------------------
// HPP guard: a reward that would sell below cost must never reach the P03 floor (which would refuse the WHOLE checkout)
// ---------------------------------------------------------------------------------------------

export type HppFinding = { promo_id: string; name: string | null };

/**
 * Per claimed reward line: net after the promo (qty x harga - discount) against the quoted cost of the line. Below cost without an Owner
 * waiver -> `blocked`; below cost WITH the waiver -> `waiverNeeded` (the receipt must then carry no voucher/points/total discount).
 * An unknown cost is not a promo problem (the existing "HPP unknown" refusal covers every goods line).
 */
export function hppFindingsForClaims<T extends ShRow>(composed: Pick<Composed<T>, "rows">, costs: readonly (number | null)[]): { blocked: HppFinding[]; waiverNeeded: HppFinding[] } {
  const blocked = new Map<string, HppFinding>(), waiverNeeded = new Map<string, HppFinding>();
  composed.rows.forEach((r, i) => {
    const c = r.sh_claim;
    const cost = costs[i];
    if (!c || c.hasil_units <= 0 || !(r.promo_discount > 0) || cost === null || cost === undefined || !Number.isFinite(cost)) return;
    const net = new PosDecimal(r.qty).times(r.harga).minus(r.promo_discount);
    if (!net.lt(cost)) return;
    const finding = { promo_id: c.promo_id, name: r.promo_name ?? null };
    (c.waiver ? waiverNeeded : blocked).set(c.promo_id, finding);
  });
  return { blocked: [...blocked.values()], waiverNeeded: [...waiverNeeded.values()] };
}

/**
 * compose -> quote the FIFO cost of the final rows -> drop every promo whose reward is below cost (no waiver) -> compose again, until stable.
 * A cart without a claim never asks for costs. Never fails the sale: the dropped promos come back with a cashier-readable note.
 */
export async function composeHppSafe<T extends ShRow>(args: {
  compose: (excludedIds: string[]) => Composed<T>;
  quoteCosts: (rows: Composed<T>["rows"]) => Promise<(number | null)[]>;
  maxRounds?: number;
}): Promise<{ composed: Composed<T>; excluded: (HppFinding & { reason: "below_hpp" })[]; waiverNeeded: HppFinding[]; notes: string[] }> {
  const excluded: (HppFinding & { reason: "below_hpp" })[] = [];
  const maxRounds = args.maxRounds ?? 70;
  for (let round = 0; ; round++) {
    const composed = args.compose(excluded.map((e) => e.promo_id));
    if (composed.strategy !== "syarat_hasil") return { composed, excluded, waiverNeeded: [], notes: notesFor(excluded) };
    const { blocked, waiverNeeded } = hppFindingsForClaims(composed, await args.quoteCosts(composed.rows));
    if (blocked.length === 0 || round >= maxRounds) {
      if (blocked.length > 0) throw new Error("Promo bundling tidak stabil terhadap HPP. Muat ulang kasir.");
      return { composed, excluded, waiverNeeded, notes: notesFor(excluded) };
    }
    for (const b of blocked) if (!excluded.some((e) => e.promo_id === b.promo_id)) excluded.push({ ...b, reason: "below_hpp" });
  }
}
const notesFor = (excluded: { name: string | null }[]) => excluded.map((e) => `Promo "${e.name ?? "tanpa nama"}" tidak diterapkan: hadiah di bawah modal.`);

/** A composed row as a plain cart line again: the composer-only bookkeeping (promo id/name, origin index) is dropped; `sh_claim` stays only when asked. */
export function composedToLine<T extends object>(row: ComposedRow<T>, keepClaim: boolean): Omit<ComposedRow<T>, "promo_id" | "promo_name" | "origin_index"> {
  const out: Record<string, unknown> = { ...row };
  delete out.promo_id; delete out.promo_name; delete out.origin_index;
  if (!keepClaim) delete out.sh_claim;
  return out as Omit<ComposedRow<T>, "promo_id" | "promo_name" | "origin_index">;
}

export type PromoSelectionInput = Pick<Composed<ShRow>, "applied" | "notApplied" | "strategy"> & Partial<Pick<Composed<ShRow>, "alternatives" | "pick">>;
const SELECTION_MAX_BYTES = 8192; // sales_promo_selection_bound
const cut = (v: string | null, n = 80) => (v === null ? null : v.length > n ? v.slice(0, n) : v);

/**
 * `sales.promo_selection` (display/audit only, never used for pricing): which promos were applied, what lost, what the cashier picked,
 * which promo was dropped by the HPP guard. Always <= 8192 bytes (names cut; alternatives capped, then dropped, then not_applied dropped).
 */
export function buildPromoSelection(
  composed: PromoSelectionInput, mode: "auto" | "tanpa" | "pilih", userId: string | null,
  extra: { pickId?: string | null; exclusive?: boolean; dropped?: { promo_id: string; name: string | null; reason: string }[] } = {},
) {
  const base = {
    version: 1, mode, pick: mode === "pilih" ? extra.pickId ?? null : null, exclusive: mode === "pilih" && extra.exclusive === true, strategy: composed.strategy,
    applied: composed.applied.map((a) => ({ promo_id: a.promo_id, name: cut(a.name), discount: a.discount, kind: a.kind })),
    not_applied: composed.notApplied.map((n) => ({ ...n, name: cut(n.name) })),
    ...(composed.alternatives && composed.alternatives.length > 0 ? { alternatives: composed.alternatives.slice(0, 20).map((a) => ({ promo_id: a.promo_id, name: cut(a.name), kind: a.kind, saving: a.saving, applied: a.applied })) } : {}),
    ...(extra.dropped && extra.dropped.length > 0 ? { dropped: extra.dropped.slice(0, 20).map((d) => ({ promo_id: d.promo_id, name: cut(d.name), reason: d.reason })) } : {}),
    by_user: userId,
  } as Record<string, unknown> & { version: number };
  const size = (o: unknown) => Buffer.byteLength(JSON.stringify(o), "utf8");
  for (const key of ["alternatives", "dropped", "not_applied", "applied"]) {
    if (size(base) <= SELECTION_MAX_BYTES - 256) break; // headroom: jsonb::text adds spaces after separators
    if (key === "applied") base.applied = (base.applied as unknown[]).slice(0, 10); else delete base[key];
  }
  return base as typeof base & { alternatives?: unknown[]; dropped?: unknown[]; applied: unknown[]; not_applied: unknown[] };
}

const HINT_RELOAD = "Muat ulang kasir lalu coba lagi.";
/** Database refusals of a promo claim, keyed by the PROMO_SH_<code>. detail = what happened (cashier language), hint = what to do. */
const SH_MESSAGES: Record<string, { detail: string; hint: string }> = {
  NILAI: { detail: "Nilai belanja setelah potongan belum memenuhi syarat promo.", hint: "Tambah belanjaan atau pilih Tanpa promo." },
  TOTAL: { detail: "Potongan promo berubah sejak keranjang dihitung (harga atau promo diubah).", hint: HINT_RELOAD },
  ELIGIBILITY: { detail: "Promo sudah tidak berlaku (nonaktif, kedaluwarsa, atau bukan untuk cabang ini).", hint: HINT_RELOAD },
  RELEASE: { detail: "Promo ini belum diaktifkan di sistem.", hint: "Hubungi Owner/Admin. Sementara itu pilih Tanpa promo atau muat ulang kasir." },
  HPP: { detail: "Rincian stok dan HPP promo tidak cocok.", hint: HINT_RELOAD },
  WAIVER: { detail: "Izin harga di bawah modal (HPP) untuk promo ini tidak berlaku.", hint: "Minta Owner memeriksa izin di pengaturan promo, atau pilih promo lain." },
  PICK: { detail: "Pilihan promo kasir tidak cocok dengan isi keranjang.", hint: "Pilih ulang promo (atau Otomatis), lalu coba lagi." },
  CLAIM: { detail: "Baris keranjang tidak sah untuk promo bundling.", hint: HINT_RELOAD },
  SNAPSHOT: { detail: "Data promo pada baris tidak boleh diubah setelah disimpan.", hint: HINT_RELOAD },
  POSITION: { detail: "Urutan baris keranjang tidak lengkap.", hint: HINT_RELOAD },
  SETS: { detail: "Jumlah kelipatan promo tidak sama antar baris atau melebihi batas.", hint: HINT_RELOAD },
  GRANTS: { detail: "Jumlah barang hadiah tidak sesuai dengan kelipatan syarat.", hint: HINT_RELOAD },
  SYARAT: { detail: "Jumlah barang syarat belum cukup untuk promo.", hint: "Tambah barang syarat atau pilih Tanpa promo." },
  LINE: { detail: "Ada baris yang tidak boleh ikut promo (barang nonaktif, harga atau satuan tidak resmi, jumlah pecahan, atau diskon manual).", hint: "Hapus diskon manual pada baris itu atau pilih Tanpa promo." },
  RULE: { detail: "Aturan promo rusak atau berubah.", hint: "Hubungi Owner/Admin untuk memeriksa promo; muat ulang kasir." },
  TARGET: { detail: "Daftar barang promo berubah dari aturannya.", hint: "Hubungi Owner/Admin untuk memeriksa promo; muat ulang kasir." },
  POST: { detail: "Transaksi belum siap diposting.", hint: HINT_RELOAD },
  // editor-side codes (promo management screens) - never shown at the cashier, mapped for completeness
  ACTIVE_EDIT: { detail: "Promo yang sedang aktif tidak boleh diubah.", hint: "Nonaktifkan promo dulu sebelum mengubah definisinya." },
  AUDIT: { detail: "Riwayat promo tidak boleh diubah.", hint: "Periksa riwayat aktivitas promo." },
  DRIFT: { detail: "Struktur database promo berubah.", hint: "Hubungi tim teknis sebelum melanjutkan." },
  DUPLICATE: { detail: "Sudah ada promo aktif dengan aturan yang sama pada tanggal dan cabang yang beririsan.", hint: "Ganti tanggal/cabang atau nonaktifkan promo yang lama." },
  EDITOR: { detail: "Editor promo belum cocok dengan database.", hint: "Hubungi tim teknis." },
  EDITOR_DRIFT: { detail: "Fungsi editor promo di database berubah.", hint: "Hubungi tim teknis sebelum melanjutkan." },
  MODE: { detail: "Mode promo tidak boleh diubah.", hint: "Buat promo baru dengan mode yang diinginkan." },
  NO_DELETE: { detail: "Promo Syarat-Hasil tidak boleh dihapus.", hint: "Nonaktifkan saja promonya." },
  OWNER_ONLY: { detail: "Izin penjualan di bawah modal (HPP) hanya boleh diatur Owner.", hint: "Minta Owner mengatur izin ini." },
};
const CLAIM_VARIANTS: [RegExp, { detail: string; hint: string }][] = [
  [/manual line discount/i, { detail: "Baris yang diberi diskon manual tidak bisa ikut promo bundling.", hint: "Hapus diskon manual pada baris itu atau pilih Tanpa promo." }],
  [/no Owner below-HPP waiver/i, { detail: "Promo ini tidak punya izin Owner untuk dijual di bawah modal (HPP).", hint: "Minta Owner mengizinkan di pengaturan promo, atau pilih promo lain." }],
  [/waiver line|promo_floor_waiver/i, { detail: "Baris hadiah di bawah modal harus berisi unit hadiah saja.", hint: HINT_RELOAD }],
  [/source_position/i, { detail: "Urutan baris keranjang tidak lengkap.", hint: HINT_RELOAD }],
  [/syarat_hasil promo can only be attached/i, { detail: "Promo bundling hanya bisa dipasang lewat klaimnya.", hint: HINT_RELOAD }],
];
const RELEASE_PICKER = { detail: "Fitur pemilih promo (ganti/batalkan promo) belum diaktifkan di sistem.", hint: "Pilih Otomatis, atau minta Owner/Reza mengaktifkannya." };

/** Database refusals of a promo claim (PROMO_SH_*, insert-time and finalization) -> a cashier-readable Indonesian message with a hint; null for any other message. */
export function pesanPromoSyaratHasil(message: string | null | undefined): string | null {
  const text = message ?? "";
  const code = /PROMO_SH_([A-Z_]+)/.exec(text)?.[1];
  if (!code) return null;
  let entry = SH_MESSAGES[code];
  if (code === "CLAIM") entry = CLAIM_VARIANTS.find(([re]) => re.test(text))?.[1] ?? entry;
  if (code === "RELEASE" && /picker/i.test(text)) entry = RELEASE_PICKER;
  const e = entry ?? { detail: "aturan promo berubah.", hint: HINT_RELOAD };
  return `Promo bundling ditolak: ${e.detail} ${e.hint}`;
}
