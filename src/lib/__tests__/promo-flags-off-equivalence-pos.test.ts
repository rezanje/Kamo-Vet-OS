import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Flags-OFF equivalence (characterization against main bb3267e0). Everything the action does to the DB (every from()/rpc() call with args, in order)
// + the redirect target is hashed per scenario and compared with the golden file RECORDED FROM MAIN (bb3267e0) with this very file:
//   PROMO_GOLDEN_WRITE=1 npx vitest run <this file>   (only ever run on a main checkout)
// Forged non-auto promoPick scenarios are the ONLY intended differences (refused, nothing written): asserted separately below.
const GOLDEN = resolve(__dirname, "promo-flags-off-golden-pos.json");
const S = vi.hoisted(() => ({
  log: [] as unknown[], uuid: 0,
  pool: "none" as string, shRows: [] as unknown[], campaign: null as null | Record<string, unknown>,
  points: 0, category: null as string | null, rpcError: "" as string, rpcFail: "" as string, saleError: "", itemsError: "", cartItemsFixture: "std" as string,
  voucher: null as null | Record<string, unknown>, flagCalls: 0,
}));
vi.mock("node:crypto", async (original) => ({ ...(await original<typeof import("node:crypto")>()), randomUUID: () => `uuid-${++S.uuid}` }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
// Skenario di file ini dijalankan sebagai Owner/Admin: izin diskon manual (12 Nov 2026) diuji terpisah di manual-discount.test.ts.
vi.mock("@/lib/manual-discount", async (original) => ({ ...(await original<typeof import("@/lib/manual-discount")>()), manualDiscountAllowed: async () => true }));
vi.mock("@/lib/inventory", () => ({ stockOut: async (_d: unknown, v: Record<string, unknown>) => { S.log.push({ stockOut: v }); return { cost: 12345 }; } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-DIFF" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => {} }));
// Struk WA (setelah respons, 14 Nov) = efek samping seperti quest/tier; tidak termasuk jejak checkout yang dibandingkan.
vi.mock("@/lib/struk-wa", () => ({ kirimStrukWaPenjualan: async () => ({ ok: false }), setelahResponsStruk: async () => {} }));
vi.mock("@/lib/kode-kampanye", async original => ({ ...await original<typeof import("@/lib/kode-kampanye")>(), bacaKodeKampanye: async () => S.campaign }));
const PRICE: Record<string, number> = { item: 20000, other: 20000, anc: 15000, jasa: 50000, grp: 100000, c1: 1, c2: 1 };
const COST: Record<string, number> = { item: 17040, other: 17040, anc: 10000, c1: 5000, c2: 6000 };
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_m: unknown, id: string) => PRICE[id], applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => {
  const pool = { id: "pool", name: "Bolt 2/6", itemIds: ["item", "other"], unit: "PCS", minQty: 2, maxQty: null, kelipatan: true, autoApply: true, discountType: "nominal", discountValue: 1, discountMode: "quantity_pool",
    quantityPool: { version: 1, unit: "PCS", normal_price: 20000, tiers: [{ qty: 6, total: 110000 }, { qty: 2, total: 38000 }] } };
  const legacy = { id: "leg", name: "Legacy anc 10%", itemIds: ["anc"], unit: "PCS", minQty: 1, maxQty: null, kelipatan: false, autoApply: true, discountType: "persen", discountValue: 10, discountMode: "normal" };
  return S.pool === "pool" ? [pool] : S.pool === "legacy" ? [legacy] : S.pool === "both" ? [pool, legacy] : [];
} }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async (_c: unknown, ids: string[]) => new Map(ids.map(id => [id, [{ unit: "PCS", factor: 1, sell_price: PRICE[id], buy_price: 0 }]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: Record<string, unknown>) => {
    S.log.push({ rpc: name, args: values });
    if (name === "promo_release_enabled") { S.flagCalls++; return { data: false, error: null }; }
    if (name === "refresh_customer_spending") return { data: true, error: null };
    if (S.rpcFail && name === S.rpcFail) return { data: null, error: { message: S.rpcError } };
    if (name !== "finalize_pos_sale" && name !== "cashier_post_stock_atomic" && name !== "quantity_pool_post_backoffice_atomic") return { data: null, error: { message: `Unexpected RPC ${name}` } };
    return { data: { sale_id: values.p_sale_id, journal_id: "journal", finalized: true, checked: true }, error: null };
  },
  from(table: string) {
    const ops: unknown[] = [];
    const rec = (op: string, ...args: unknown[]) => { ops.push([op, ...args]); return query; };
    const stdItems = Object.keys(PRICE).map(id => ({ id, code: id, nama: id, name: id, unit: "PCS", item_type: id === "grp" ? "Grup" : id === "jasa" ? "Jasa" : "Persediaan", tindakan_kategori: null, sell_price: PRICE[id], buy_price: 0, min_sell_qty: 1, is_active: true }));
    const data: unknown = table === "items" ? stdItems
      : table === "stock_layers" ? Object.keys(COST).map(id => ({ id: `layer:${id}`, item_id: id, qty_left: 100, unit_cost: COST[id], exp_date: null, tanggal: "2026-10-15", created_at: "2026-10-15T00:00:00Z" }))
      : table === "promos" ? S.shRows
      : table === "item_group_components" ? [{ id: "r1", group_item_id: "grp", component_item_id: "c1", qty: 1, unit: "PCS", factor: 1, sort_order: 0, component: { id: "c1", code: "c1", name: "c1", item_type: "Persediaan", is_active: true } }, { id: "r2", group_item_id: "grp", component_item_id: "c2", qty: 2, unit: "PCS", factor: 1, sort_order: 1, component: { id: "c2", code: "c2", name: "c2", item_type: "Persediaan", is_active: true } }]
      : table === "category_discounts" ? [{ id: "d1", item_id: "item", item_category_id: null, diskon_persen: 5 }]
      : [];
    let lookup = false; let codeQuery: unknown = null;
    const single = () => {
      if (table === "vouchers") return { data: S.voucher && codeQuery === S.voucher.code ? S.voucher : null, error: null };
      if (table === "sales" && !lookup && S.saleError) return { data: null, error: { message: S.saleError } };
      return { data: table === "sales" && lookup ? null : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" } : table === "customers" ? { points: S.points, total_spending: 0, category_id: S.category, customer_categories: S.category ? { discount_percent: 0, points_per_rupiah: 1000 } : null }
        : table === "warehouses" ? { id: "warehouse" } : { id: table === "sales" ? "sale" : "line" }, error: null };
    };
    const query = {
      select: (f: string, o?: unknown) => { lookup = typeof f === "string" && f.includes("checkout_fingerprint"); return rec("select", f, o); },
      eq: (k: string, v: unknown) => { if (k === "code") codeQuery = v; return rec("eq", k, v); },
      in: (...a: unknown[]) => rec("in", ...a), gt: (...a: unknown[]) => rec("gt", ...a), lte: (...a: unknown[]) => rec("lte", ...a), not: (...a: unknown[]) => rec("not", ...a), order: (...a: unknown[]) => rec("order", ...a), range: (...a: unknown[]) => rec("range", ...a), limit: (...a: unknown[]) => rec("limit", ...a),
      insert: (v: unknown) => { S.log.push({ table, insert: v }); return query; },
      update: (v: unknown) => { S.log.push({ table, update: v }); return query; },
      delete: () => { S.log.push({ table, delete: true }); return query; },
      single: async () => { S.log.push({ table, ops, term: "single" }); return single(); },
      maybeSingle: async () => { S.log.push({ table, ops, term: "maybeSingle" }); return single(); },
      then: (resolve: (value: unknown) => unknown) => { S.log.push({ table, ops, term: "await" }); return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve); },
    };
    return query;
  },
}) }));
import { checkoutSale as checkoutKasir } from "@/app/(app)/pos/transaksi/actions";

const RULE = { discount_mode: "syarat_hasil", suggest: "x", syarat_hasil: { version: 1, repeat: true, syarat: [{ kind: "qty", min: 2, items: [{ item_id: "item", unit: "PCS" }, { item_id: "other", unit: "PCS" }] }],
  hasil: { kind: "barang", items: [{ item_id: "anc", unit: "PCS" }], discount: { type: "nominal", value: 3000 } }, below_hpp: { allowed: false } } };
const SH = [{ id: "sh1", name: "SH", rule: RULE, branch_ids: null, valid_from: null, valid_until: null }];
const VOUCHER = { code: "HEMAT10", tipe: "persen", nilai: 10, is_active: true, valid_from: null, valid_until: null, max_potongan: null, min_belanja: 0, boleh_gabung_promo: true, customer_id: null, category_id: null };

type Sc = { name: string; lines: [string, number][]; extra?: Record<string, string>; pool?: string; sh?: boolean; points?: number; category?: string; voucher?: Record<string, unknown>; campaign?: Record<string, unknown>; rpcFail?: string; rpcError?: string; forged?: Record<string, unknown>; lineExtra?: Record<string, unknown>; saleError?: string };
const scenarios: Sc[] = [];
const add = (s: Sc) => scenarios.push(s);
for (const sh of [false, true]) for (const pool of ["none", "pool", "legacy", "both"]) {
  const t = `${sh ? "SHrows+flagOFF " : "noSH "}pool=${pool} `;
  add({ name: t + "plain 1 item", lines: [["item", 1]], pool, sh });
  add({ name: t + "pool pair 1+1", lines: [["item", 1], ["other", 1]], pool, sh });
  add({ name: t + "pool 6", lines: [["item", 6]], pool, sh });
  add({ name: t + "pool 3+3 + anc", lines: [["item", 3], ["other", 3], ["anc", 2]], pool, sh });
  add({ name: t + "item2+anc1 (SH bundle shape)", lines: [["item", 2], ["anc", 1]], pool, sh });
  add({ name: t + "jasa+item", lines: [["jasa", 1], ["item", 2]], pool, sh });
  add({ name: t + "grup", lines: [["grp", 1], ["item", 1]], pool, sh });
  add({ name: t + "voucher", lines: [["item", 2], ["anc", 1]], extra: { voucherCode: "BOLT26" }, campaign: { code: "BOLT26", voucher_id: "v1", promo_id: null, is_active: true, max_uses: null, vouchers: { code: "HEMAT10" } }, voucher: VOUCHER, pool, sh });
  add({ name: t + "voucher no-combine", lines: [["item", 2], ["anc", 1]], extra: { voucherCode: "HEMAT10" }, voucher: { ...VOUCHER, boleh_gabung_promo: false }, pool, sh });
  add({ name: t + "points", lines: [["item", 2], ["anc", 1]], extra: { poinDigunakan: "300" }, points: 500, pool, sh });
  add({ name: t + "points>total", lines: [["item", 1]], extra: { poinDigunakan: "999999" }, points: 999999, pool, sh });
  add({ name: t + "diskon total", lines: [["item", 2], ["anc", 1]], extra: { discount: "1500" }, pool, sh });
  add({ name: t + "member category", lines: [["item", 2], ["anc", 1]], category: "cat1", pool, sh });
  add({ name: t + "item discount", lines: [["item", 2], ["anc", 1]], lineExtra: { item_discount_type: "percent", item_discount_value: 10 }, pool, sh });
  add({ name: t + "split pay", lines: [["item", 2], ["anc", 1]], extra: { metode: "Split", bayar: "30000", split_payments: JSON.stringify([{ method: "Tunai", amount: 30000 }, { method: "Debit", amount: 22000 }]) }, pool, sh });
  add({ name: t + "debit merchant fee", lines: [["item", 2], ["anc", 1]], extra: { metode: "Debit", bayar: "0", merchant_fee_percent: "1.5" }, pool, sh });
  add({ name: t + "manual line (no item_id)", lines: [["", 2]], pool, sh });
  add({ name: t + "forged client fields", lines: [["item", 2], ["anc", 1]], forged: { official_price: 1, sh_claim: { promo_id: "sh1", sets: 1 }, promo_claim_id: "sh1", promo_floor_waiver: true }, pool, sh });
  add({ name: t + "pick auto", lines: [["item", 2], ["anc", 1]], extra: { promoPick: "auto" }, pool, sh });
  add({ name: t + "pick empty", lines: [["item", 2], ["anc", 1]], extra: { promoPick: "" }, pool, sh });
  add({ name: t + "pick none", lines: [["item", 2], ["anc", 1]], extra: { promoPick: "none" }, pool, sh });
  add({ name: t + "pick id pool", lines: [["item", 2], ["anc", 1]], extra: { promoPick: "pool" }, pool, sh });
  add({ name: t + "pick id sh1", lines: [["item", 2], ["anc", 1]], extra: { promoPick: "sh1" }, pool, sh });
  add({ name: t + "pick garbage", lines: [["item", 2], ["anc", 1]], extra: { promoPick: "x;drop" }, pool, sh });
  add({ name: t + "promoExpect forged", lines: [["item", 2], ["anc", 1]], extra: { promoExpect: "99999" }, pool, sh });
  add({ name: t + "promoExpect garbage", lines: [["item", 2], ["anc", 1]], extra: { promoExpect: "abc" }, pool, sh });
  add({ name: t + "promoSelection forged", lines: [["item", 2], ["anc", 1]], extra: { promoSelection: "x".repeat(9000), promo_pick_mode: "pilih", promo_pick_id: "sh1" }, pool, sh });
  add({ name: t + "finalize err generic", lines: [["item", 2], ["anc", 1]], rpcFail: "cashier_post_stock_atomic", rpcError: "stock_out failed: layer gone", pool, sh });
  add({ name: t + "finalize err KODE_KAMPANYE", lines: [["item", 2], ["anc", 1]], rpcFail: "cashier_post_stock_atomic", rpcError: "KODE_KAMPANYE: kode habis", pool, sh });
  add({ name: t + "finalize err P03", lines: [["item", 2], ["anc", 1]], rpcFail: "cashier_post_stock_atomic", rpcError: "P03: harga di bawah modal", pool, sh });
  add({ name: t + "finalize err P05", lines: [["item", 2], ["anc", 1]], rpcFail: "cashier_post_stock_atomic", rpcError: "P05: something", pool, sh });
  add({ name: t + "sale insert err", lines: [["item", 2], ["anc", 1]], saleError: "duplicate key value violates unique constraint", pool, sh });
  add({ name: t + "campaign promo code", lines: [["item", 2], ["other", 1]], extra: { voucherCode: "BOLT26" }, campaign: { code: "BOLT26", voucher_id: null, promo_id: "pool", is_active: true, max_uses: null, vouchers: null }, pool, sh });
  add({ name: t + "campaign voucher code", lines: [["item", 2], ["anc", 1]], extra: { voucherCode: "PROMO10" }, campaign: { code: "PROMO10", voucher_id: "v1", promo_id: null, is_active: true, max_uses: null, vouchers: { code: "HEMAT10" } }, voucher: VOUCHER, pool, sh });
}

it("flags OFF: every scenario is byte-identical to main (hash of the DB call log + outcome); forged non-auto picks are refused with nothing written", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-04T05:00:00Z"));
  const out: Record<string, unknown> = {}; const hashes: Record<string, string> = {}; const forgedPicks: string[] = [];
  const isForgedPick = (name: string) => /pick (none|id |garbage)/.test(name);
  // The two additions stage 3b/4 accepted on the back office (read-only, no effect on pricing/writes): the syarat-hasil promos read and the release-flag RPC.
  // Hidden-customer guard (customers.hidden_at, read-only; no effect on pricing/writes when the customer is visible).
  const isHiddenCustomerCheck = (e: unknown) => (e as { table?: string }).table === "customers"
    && JSON.stringify((e as { ops?: unknown[] }).ops?.[0]) === JSON.stringify(["select", "hidden_at", null]);
  const normalise = (log: unknown[]) => log.filter((e) => !isHiddenCustomerCheck(e) && !((e as { table?: string; ops?: unknown }).table === "promos" && JSON.stringify((e as { ops?: unknown }).ops).includes("rule->>discount_mode")) && (e as { rpc?: string }).rpc !== "promo_release_enabled");
  for (const sc of scenarios) {
    S.log = []; S.uuid = 0; S.flagCalls = 0;
    Object.assign(S, { pool: sc.pool ?? "none", shRows: sc.sh ? SH : [], campaign: sc.campaign ?? null, points: sc.points ?? 0, category: sc.category ?? null, rpcFail: sc.rpcFail ?? "", rpcError: sc.rpcError ?? "", saleError: sc.saleError ?? "", voucher: sc.voucher ?? null });
    const data = new FormData();
    Object.entries({ branchId: "branch", customerId: "customer", metode: "Tunai", bayar: "500000", operationalShiftId: "shift", checkout_key: "diff-key-pos", ...(sc.extra ?? {}),
      cart: JSON.stringify(sc.lines.map(([item_id, qty]) => ({ item_id, nama: item_id ? "Wrong caller name" : "Ketikan manual", qty, harga: item_id ? 1 : 12345, satuan: "PCS", promo_discount: 999999, officialPrice: 1, ...(sc.forged ?? {}), ...(sc.lineExtra ?? {}) }))) }).forEach(([k, v]) => data.set(k, v as string));
    const outcome = await checkoutKasir(data).then(() => "ok", e => (e as Error).message);
    out[sc.name] = { outcome: decodeURIComponent(outcome), log: S.log, flagCalls: S.flagCalls };
    if (isForgedPick(sc.name)) {
      forgedPicks.push(sc.name);
      // intended difference from main: a forged promoPick is refused (Indonesian message), never written
      if (process.env.PROMO_GOLDEN_WRITE === "1") continue; // recording on main: only the branch must refuse
      expect(decodeURIComponent(outcome), sc.name).toMatch(/error=/);
      expect(S.log.some((e) => JSON.stringify(e).includes('"insert"') || JSON.stringify(e).includes('"delete"') || JSON.stringify(e).includes('"update"')), sc.name).toBe(false);
      expect(S.log.some((e) => { const r = (e as { rpc?: string }).rpc; return r !== undefined && r !== "promo_release_enabled"; }), sc.name).toBe(false);
      continue;
    }
    hashes[sc.name] = createHash("sha256").update(JSON.stringify({ outcome: decodeURIComponent(outcome), log: normalise(S.log) })).digest("hex");
  }
  vi.useRealTimers();
  expect(forgedPicks.length).toBeGreaterThan(0);
  if (process.env.PROMO_GOLDEN_WRITE === "1") { writeFileSync(GOLDEN, JSON.stringify(hashes, null, 0)); return; }
  expect(existsSync(GOLDEN)).toBe(true);
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
  expect(Object.keys(hashes).sort()).toEqual(Object.keys(golden).sort());
  const different = Object.keys(hashes).filter((k) => hashes[k] !== golden[k]);
  expect(different).toEqual([]);
}, 120000);
