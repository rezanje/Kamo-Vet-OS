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
  // Stage 3 never plans a below-HPP waiver (the TS price floor has no waiver yet, stage 3b): the engine always sees allow_below_hpp = false.
  const defs = aktif.flatMap((p) => { const d = syaratHasilDefFromRow(p, { belowHppReleased: false }); return d ? [d] : []; });
  return { released: true, pickerReleased, belowHppReleased, defs };
}

// ---------------------------------------------------------------------------------------------
// Pure composition
// ---------------------------------------------------------------------------------------------

export type ShRow = {
  item_id: string; nama?: string; qty: number; harga: number; satuan?: string | null; faktor?: number;
  item_type?: string;
  /** Master price per unit BEFORE tier/negotiated reductions (branch price, else unit/base price). Absent = free text / no master. */
  officialPrice?: number;
  item_discount_type?: "nominal" | "percent" | null; item_discount_value?: number | null;
};
export type LegacyHit = { lineIndex: number; potongan: number; promoId: string; promoName?: string };
export type ShClaimMeta = { promo_id: string; sets: number; syarat_units: number; hasil_units: number; waiver: boolean };
export type ComposedRow<T> = T & { promo_discount: number; promo_id: string | null; promo_name: string | null; sh_claim?: ShClaimMeta; origin_index: number };
export type AppliedPromo = { promo_id: string; name: string | null; discount: number; kind: "syarat_hasil" | "legacy" };
export type Composed<T> = {
  rows: ComposedRow<T>[];
  strategy: "none" | "legacy" | "syarat_hasil";
  applied: AppliedPromo[];
  savings: { legacy: number; syarat_hasil: number; total: number };
  /** syarat_hasil promos that applied on their own but lost against the winning combination (less saving for the customer). */
  notApplied: { promo_id: string; name: string | null; saving: number }[];
  skipped: { promo_id: string | null; code: string }[];
};

type Part<T> = { row: T; origin: number; claim?: ShClaimMeta; discount: number; promoId: string | null; promoName: string | null };
type Candidate<T> = { parts: Part<T>[]; legacy: number; sh: number; claimed: { promo_id: string; name: string | null; discount: number }[]; skipped: Composed<T>["skipped"] };

const numberOr0 = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function composeSyaratHasilCart<T extends ShRow>(args: {
  rows: readonly T[];
  defs: readonly SyaratHasilDef[];
  /** The existing promo engine over a set of rows (serviceLinePromos / hitungPromoKeranjang); hits refer to indexes of the rows it is given. */
  legacy: (rows: T[]) => LegacyHit[];
  /** "tanpa" = the cashier chose no promo at all. */
  mode?: "auto" | "tanpa";
}): Composed<T> {
  const { rows, defs, legacy, mode = "auto" } = args;
  const nameOf = new Map(defs.map((d) => [d.id, d.name ?? null] as const));

  const legacyOver = (subset: T[]): { discount: number[]; id: (string | null)[]; name: (string | null)[]; total: number } => {
    const discount = subset.map(() => 0), id = subset.map(() => null as string | null), name = subset.map(() => null as string | null);
    for (const h of legacy(subset)) {
      if (!Number.isInteger(h.lineIndex) || h.lineIndex < 0 || h.lineIndex >= subset.length) continue;
      discount[h.lineIndex] = h.potongan; id[h.lineIndex] = h.promoId; name[h.lineIndex] = h.promoName ?? null; // last hit wins, like the original assignment
    }
    return { discount, id, name, total: discount.reduce((s, x) => s + numberOr0(x), 0) };
  };

  const finish = (cand: Candidate<T>, notApplied: Composed<T>["notApplied"]): Composed<T> => {
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
    return { rows: out, strategy, applied, savings: { legacy: cand.legacy, syarat_hasil: cand.sh, total: cand.legacy + cand.sh }, notApplied, skipped: cand.skipped };
  };

  const plainCandidate = (subset: T[], withLegacy: boolean): Candidate<T> => {
    const lg = withLegacy ? legacyOver(subset) : null;
    return {
      parts: subset.map((row, i) => ({ row, origin: i, discount: lg ? lg.discount[i] : 0, promoId: lg ? lg.id[i] : null, promoName: lg ? lg.name[i] : null })),
      legacy: lg ? lg.total : 0, sh: 0, claimed: [], skipped: [],
    };
  };

  const cand0 = plainCandidate([...rows], mode !== "tanpa");
  if (mode === "tanpa" || defs.length === 0) return finish(cand0, []);

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

  const buildFromEngine = (res: SyaratHasilResult): Candidate<T> | null => {
    const claimedPromos = new Map<string, { sets: number; discount: number }>();
    const parts: Part<T>[] = [];
    rows.forEach((row, i) => {
      const lr = res.lines[i];
      const c = lr?.claims[0];
      if (!lr || lr.source_position !== i) throw new Error("engine lines out of order");
      if (!c) { parts.push({ row, origin: i, discount: 0, promoId: null, promoName: null }); return; }
      const S = c.syarat_units, H = c.hasil_units, rest = row.qty - S - H;
      const waiver = lr.below_hpp_waiver;
      const cur = claimedPromos.get(c.promo_id) ?? { sets: c.sets_consumed, discount: 0 };
      cur.discount += c.discount; claimedPromos.set(c.promo_id, cur);
      const claimLine = (qty: number, syarat: number, hasil: number, discount: number, wv: boolean) => parts.push({
        row: { ...row, qty }, origin: i, discount, promoId: hasil > 0 && discount > 0 ? c.promo_id : null, promoName: hasil > 0 && discount > 0 ? nameOf.get(c.promo_id) ?? null : null,
        claim: { promo_id: c.promo_id, sets: c.sets_consumed, syarat_units: syarat, hasil_units: hasil, waiver: wv },
      });
      if (waiver && H > 0 && S > 0) { claimLine(S, S, 0, 0, false); claimLine(H, 0, H, c.discount, true); }
      else claimLine(S + H, S, H, c.discount, waiver && H > 0 && S === 0);
      if (rest > 0) parts.push({ row: { ...row, qty: rest }, origin: i, discount: 0, promoId: null, promoName: null });
    });
    if (claimedPromos.size === 0) return null;
    // legacy promos over the PLAIN lines only (a claimed line is not a Bolt-pool member in the database)
    const plain = parts.filter((p) => !p.claim);
    const lg = legacyOver(plain.map((p) => p.row));
    plain.forEach((p, k) => { p.discount = lg.discount[k]; p.promoId = lg.id[k]; p.promoName = lg.name[k]; });
    // the nilai syarat must still hold on the FINAL charges
    const money = finalNilai(parts);
    for (const [promoId, info] of claimedPromos) {
      const def = defs.find((d) => d.id === promoId);
      if (!def) return null;
      for (const r of def.syarat) if (r.kind === "nilai" && money < info.sets * r.min) return null;
    }
    const sh = [...claimedPromos.values()].reduce((s, x) => s + x.discount, 0);
    return {
      parts, legacy: lg.total, sh,
      claimed: [...claimedPromos].map(([promo_id, v]) => ({ promo_id, name: nameOf.get(promo_id) ?? null, discount: v.discount })),
      skipped: res.skipped.map((s) => ({ promo_id: s.promo_id, code: s.code })),
    };
  };

  const attempt = (disc: number[] | null): { cand: Candidate<T> | null; skipped: Composed<T>["skipped"] } => {
    try {
      const res = calculateSyaratHasilSafe(engineLines([...rows], disc), defs, { one_promo_per_line: true, alternatives: false });
      return { cand: buildFromEngine(res), skipped: res.skipped.map((s) => ({ promo_id: s.promo_id, code: s.code })) };
    } catch {
      return { cand: null, skipped: [] }; // fail closed: the legacy result stands
    }
  };

  const legacyKnown = attempt(legacyOver([...rows]).discount); // syarat-hasil planned around the legacy discounts
  const shFirst = attempt(null);                              // syarat-hasil first, legacy on what is left
  const skipped = [...legacyKnown.skipped, ...shFirst.skipped].filter((s, i, all) => all.findIndex((o) => o.promo_id === s.promo_id && o.code === s.code) === i);
  const tried = [legacyKnown.cand, shFirst.cand].filter((c): c is Candidate<T> => c !== null);
  let best = cand0;
  for (const c of tried) if (c.legacy + c.sh > best.legacy + best.sh) best = c;
  const lost = tried.filter((c) => c !== best && c.claimed.length > 0).sort((a, b) => (b.legacy + b.sh) - (a.legacy + a.sh))[0];
  const notApplied = best.claimed.length > 0 || !lost ? [] : lost.claimed.map((c) => ({ promo_id: c.promo_id, name: c.name, saving: c.discount }));
  const out = finish(best, notApplied);
  return { ...out, skipped };
}

/** A composed row as a plain cart line again: the composer-only bookkeeping (promo id/name, origin index) is dropped; `sh_claim` stays only when asked. */
export function composedToLine<T extends object>(row: ComposedRow<T>, keepClaim: boolean): Omit<ComposedRow<T>, "promo_id" | "promo_name" | "origin_index"> {
  const out: Record<string, unknown> = { ...row };
  delete out.promo_id; delete out.promo_name; delete out.origin_index;
  if (!keepClaim) delete out.sh_claim;
  return out as Omit<ComposedRow<T>, "promo_id" | "promo_name" | "origin_index">;
}

/** `sales.promo_selection` (display/audit only, never used for pricing): which promos were applied and what lost. */
export function buildPromoSelection(composed: Pick<Composed<ShRow>, "applied" | "notApplied" | "strategy">, mode: "auto" | "tanpa", userId: string | null) {
  return {
    version: 1, mode, strategy: composed.strategy,
    applied: composed.applied.map((a) => ({ promo_id: a.promo_id, name: a.name, discount: a.discount, kind: a.kind })),
    not_applied: composed.notApplied,
    by_user: userId,
  };
}

/** Database refusals of a promo claim (PROMO_SH_*) -> a cashier-readable message; null for any other message. */
export function pesanPromoSyaratHasil(message: string | null | undefined): string | null {
  const code = /PROMO_SH_([A-Z_]+)/.exec(message ?? "")?.[1];
  if (!code) return null;
  const detail: Record<string, string> = {
    NILAI: "Nilai belanja setelah potongan belum memenuhi syarat promo.",
    TOTAL: "Potongan promo berubah sejak keranjang dihitung.",
    ELIGIBILITY: "Promo sudah tidak berlaku (nonaktif, kedaluwarsa, atau bukan untuk cabang ini).",
    RELEASE: "Promo ini belum diaktifkan di sistem.",
    HPP: "Rincian stok dan HPP promo tidak cocok.",
    WAIVER: "Izin harga di bawah HPP untuk promo ini tidak berlaku.",
    PICK: "Pilihan promo kasir tidak cocok dengan isi keranjang.",
  };
  return `Promo bundling ditolak: ${detail[code] ?? "aturan promo berubah."} Muat ulang kasir lalu coba lagi.`;
}
