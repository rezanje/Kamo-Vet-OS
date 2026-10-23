import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", confirmation: true, stock: false, pointsWrites: 0, prior: null as null | Record<string, unknown>, lostResponse: false, tierUnavailable: false }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-SPLIT-TEST" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => ({ cost: 34567 }) }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map([["item", [{ unit: "pcs", factor: 1, sell_price: 100000, buy_price: 0 }]]]) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    if (name === "refresh_customer_spending") { if(state.tierUnavailable) throw Error("derived statistics unavailable"); return {data:true,error:null}; }
    if (name !== "finalize_pos_sale") throw Error(`Unexpected RPC ${name}`);
    if (state.lostResponse) {
      state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: state.headers[0]?.checkout_fingerprint, payments_finalized_at: "2026-10-15T08:00:00Z" };
      return { data: null, error: { message: "Connection lost after commit" } };
    }
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    state.finalized.push(values.p_sale_id);
    if(state.confirmation && state.prior)state.prior.payments_finalized_at="2026-10-15T08:00:00Z";
    return { data: state.confirmation ? { sale_id: values.p_sale_id, journal_id: "journal", finalized: true } : null, error: null };
  },
  from(table: string) {
    let lookup = false;
    let lineUpdate: Record<string, unknown> | null = null;
    let data: unknown = table === "items" ? [{ id: "item", nama: "Pakan", name: "Pakan", unit: "pcs", item_type: state.stock ? "Persediaan" : "Jasa", sell_price: 100000, min_sell_qty: 1, is_active: true }] : [];
    const single = () => ({ data: table === "sales" && lookup ? state.prior : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? (state.stock ? { id: "warehouse" } : null) : { id: table === "sales" ? "sale" : "line" }, error: null });
    const query = {
      select: (fields: string) => { lookup = fields.includes("checkout_fingerprint"); return query; }, eq: (key: string, value: unknown) => { if (table === "sale_items" && key === "id" && lineUpdate) state.items.filter(item => item.id === value).forEach(item => Object.assign(item, lineUpdate)); return query; }, in: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales") { state.headers.push(value); data = value; state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; } if (table === "sale_items") state.items.push({ id: "line", ...value }); if (table === "point_ledger") state.pointsWrites++; return query; },
      update: (value: Record<string, unknown>) => { lineUpdate = value; return query; }, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";

beforeEach(() => { state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.confirmation = true; state.stock = false; state.pointsWrites = 0; state.prior = null; state.lostResponse = false; state.tierUnavailable = false; });
function form(parts = [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }]) {
  const data = new FormData();
  Object.entries({ branchId: "branch", customerId: "customer", salespersonId: "seller", metode: "Split", bayar: "20000", split_payments: JSON.stringify(parts), operationalShiftId: "shift", checkout_key: "checkout-draft",
    cart: JSON.stringify([{ item_id: "item", nama: "Pakan", qty: 1, harga: 100000, target_species: "Universal", satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s saves exactly one 100k sale with its 20k cash / 80k transfer plan and finalizes before receipt", async (_label, action) => {
  const outcome = await action(form()).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers).toHaveLength(1);
  expect(state.headers[0]).toMatchObject({ total: 100000, metode_bayar: "Split", bayar: 100000, kembali: 0,
    payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }] });
  expect(state.finalized).toEqual(["sale"]);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s rejects a short split before creating a sale", async (_label, action) => {
  const outcome = await action(form([{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 70000 }])).then(() => "unexpected success", error => error.message);
  expect(outcome).not.toContain("/struk/");
  expect(state.headers).toHaveLength(0);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s never issues a receipt when accounting finalization fails", async (_label, action) => {
  state.finalizationError = "Pembukuan belum dapat diselesaikan";
  const outcome = await action(form()).then(() => "unexpected success", error => error.message);
  expect(outcome).not.toContain("/struk/");
  expect(state.finalized).toEqual([]);
  expect(state.removed).toBe(true);
  expect(state.pointsWrites).toBe(0);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s records only cash change and saves actual FIFO cost per line", async (_label, action) => {
  state.stock = true;
  const input = form(); input.set("bayar", "50000");
  const outcome = await action(input).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 100000, bayar: 130000, kembali: 30000 });
  expect(state.items).toHaveLength(1);
  expect(state.items[0]).toMatchObject({ sale_id: "sale", hpp: 34567 });
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s requires a positive database finalization acknowledgement", async (_label, action) => {
  state.confirmation = false;
  const outcome = await action(form()).then(() => "unexpected success", error => error.message);
  expect(outcome).not.toContain("/struk/");
  expect(state.removed).toBe(true);
  expect(state.pointsWrites).toBe(0);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s preserves ordinary single-method payments", async (_label, action) => {
  const input = form(); input.set("metode", "Transfer"); input.set("bayar", "0"); input.set("split_payments", "");
  const outcome = await action(input).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 100000, metode_bayar: "Transfer", bayar: 100000, kembali: 0, payment_plan: [{ method: "Transfer", amount: 100000 }] });
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s rounds fractional extended prices once before validating allocations", async (_label, action) => {
  const input = form([{ method: "Tunai", amount: 10 }, { method: "Transfer", amount: 23.32 }]);
  input.set("cart", JSON.stringify([{ item_id: null, nama: "Jasa pecahan", qty: 0.3333, harga: 99.99, target_species: "Universal" }]));
  input.set("diskon", "0.01"); input.set("discount", "0.01"); input.set("bayar", "10");
  const outcome = await action(input).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 33.33, discount: 0.01, total: 33.32 });
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s finalizes free sales without inventing payment allocations", async (_label, action) => {
  const input = form(); input.set("metode", "Tunai"); input.set("split_payments", "[]"); input.set("bayar", "0");
  input.set("diskon", "200000"); input.set("discount", "200000");
  const outcome = await action(input).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 100000, discount: 100000, total: 0, bayar: 0, kembali: 0, payment_plan: [] });
  expect(state.finalized).toEqual(["sale"]);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s recovers a committed checkout after losing the finalizer response without creating another sale", async (_label, action) => {
  state.lostResponse = true;
  const first = await action(form()).then(() => "unexpected success", error => error.message);
  expect(first).toContain("/struk/sale");
  expect(state.removed).toBe(false);
  const retry = await action(form()).then(() => "unexpected success", error => error.message);
  expect(retry).toContain("/struk/sale");
  expect(state.headers).toHaveLength(1);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s refuses a different payment intent under an already used draft identity", async (_label, action) => {
  state.prior = { id: "existing", no_struk: "POS-EXISTING", checkout_fingerprint: "different", payments_finalized_at: "2026-10-15T08:00:00Z" };
  const outcome = await action(form()).then(() => "unexpected success", error => error.message);
  expect(outcome).not.toContain("/struk/");
  expect(state.headers).toHaveLength(0);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s agrees with PostgreSQL numeric rounding at an exact half-cent", async (_label, action) => {
  const input = form([{ method: "Tunai", amount: 1000 }, { method: "Transfer", amount: 9000.01 }]);
  input.set("cart", JSON.stringify([{ item_id: null, nama: "Jasa setengah", qty: 0.5, harga: 20000.01, target_species: "Universal" }]));
  input.set("bayar", "1000");
  const outcome = await action(input).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 10000.01, total: 10000.01, discount: 0 });
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s persists gross split fee allocations while keeping goods and earned points separate", async (_label, action) => {
  const input = form(); input.set("split_payments", '[{"method":"Tunai","amount":20000},{"method":"Debit","amount":80000,"feePercent":2}]'); input.set("bayar", "50000");
  const outcome = await action(input).then(() => "unexpected success", error => error.message);
  expect(outcome).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 100000, total: 101600, merchant_fee_total: 1600, discount: 0, bayar: 131600, kembali: 30000, poin_earned: 100,
    payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Debit", amount: 81600, fee_percent: 2, fee_amount: 1600 }] });
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s charges a single method fee and recovers only the same rate after lost response", async (_label, action) => {
  const input = form(); input.set("metode", "Debit"); input.set("split_payments", "[]"); input.set("merchant_fee_percent", "2"); input.set("bayar", "0");
  state.lostResponse = true;
  expect(await action(input).catch(error => error.message)).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ total: 102000, merchant_fee_total: 2000, payment_plan: [{ method: "Debit", amount: 102000, fee_percent: 2, fee_amount: 2000 }] });
  expect(await action(input).catch(error => error.message)).toContain("/struk/sale");
  input.set("merchant_fee_percent", "3");
  expect(await action(input).catch(error => error.message)).not.toContain("/struk/");
  expect(state.headers).toHaveLength(1);
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s rejects a forged cash fee before writing", async (_label, action) => {
  const input = form(); input.set("metode", "Tunai"); input.set("split_payments", "[]"); input.set("bayar", "100000"); input.set("merchant_fee_percent", "2");
  expect(await action(input).catch(error => error.message)).not.toContain("/struk/");
  expect(state.headers).toHaveLength(0);
});

it.each(["invalid-input", "finalization", "pending-retry"])("keeps cashier replacement draft context on %s", async failure => {
 const input=form(); const source="00000000-0000-4000-8000-000000000001";input.set("replacementSaleId",source);
 if(failure==="invalid-input") input.set("customerId","");
 if(failure==="finalization") state.finalizationError="Period closed";
 if(failure==="pending-retry") state.prior={id:"pending",no_struk:"Pending source",checkout_fingerprint:"changed",payments_finalized_at:null};
 const outcome=await checkoutKasir(input).then(()=>"unexpected success",error=>error.message);
 expect(outcome).toContain(`replace_sale=${source}`);expect(outcome).toContain("error=");expect(outcome).not.toContain("/struk/");
});

it.each([["cashier", checkoutKasir], ["backoffice", checkoutSale]] as const)("%s still opens a committed receipt and recovers it if derived customer refresh is unavailable",async(_label,action)=>{
 state.tierUnavailable=true;
 const input=form();
 expect(await action(input).then(()=>"unexpected",e=>e.message)).toContain("/struk/sale");
 expect(state.headers).toHaveLength(1);expect(state.finalized).toEqual(["sale"]);
 expect(await action(input).then(()=>"unexpected",e=>e.message)).toContain("/struk/sale");
 expect(state.headers).toHaveLength(1);expect(state.finalized).toEqual(["sale"]);
});
