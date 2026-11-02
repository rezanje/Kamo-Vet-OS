import { beforeEach, expect, it, vi } from "vitest";
import type { PromoHitung } from "@/lib/promo-hitung";
import { HPP_CONFIRM_FIELD } from "@/lib/hpp-warning";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], lines: [] as Record<string, unknown>[], itemType: "Jasa", employeeId: "login-employee" as string | null, promos: [] as PromoHitung[], price: 100, categoryPercent: 0,
  stock: false, rpcCalls: [] as { name: string; args: Record<string, unknown> }[], rejectedItem: "", events: [] as string[], hppUpdates: [] as { id: string; hpp: unknown }[], layerCost: 0 }));
const POSTING = ["pos_backoffice_post_atomic", "finalize_pos_sale", "quantity_pool_post_backoffice_atomic", "sale_stock_out_fifo"];
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/service-performers-server", async original => ({ ...await original<typeof import("@/lib/service-performers-server")>(), loggedInCashier: async () => ({ employeeId: state.employeeId, name: "Kasir masuk" }) }));
vi.mock("@/lib/pos-checkout-identity", () => ({ posCheckoutIdentity: () => ({ key: "draft", fingerprint: "fingerprint" }), resumePosCheckout: async () => {} }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-TEST" }) }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => {} }));
// Backoffice must never issue stock over separate per-line HTTP calls again.
vi.mock("@/lib/inventory", () => ({ stockOut: async () => { throw Error("per-line stockOut is not allowed in backoffice checkout"); } }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => state.promos }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map(["item", "physical"].map(id => [id, [{ unit: "pcs", factor: 1, sell_price: state.price, buy_price: 0 }]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (POSTING.includes(name)) { state.rpcCalls.push({ name, args }); state.events.push(`rpc:${name}`); }
    return { data: { sale_id: "sale", finalized: true, ...(name === "pos_backoffice_post_atomic" ? { checked: true, stock_events: 1 } : {}) }, error: null };
  },
  from(table: string) {
    const data = table === "items" ? [{ id: "item", item_type: state.itemType }, { id: "physical", item_type: "Persediaan" }]
      : table === "employees" ? [{ id: "doctor", nama: "Dokter", jabatan: "Dokter Hewan" }, { id: "staff", nama: "Staf", jabatan: "Groomer" }, { id: "different", nama: "Staf lain", jabatan: "Groomer" }]
      : table === "stock_layers" && state.layerCost > 0 ? [{ id: "layer", item_id: "physical", qty_left: 10, unit_cost: state.layerCost, exp_date: null, tanggal: "2026-10-01", created_at: "2026-10-01T00:00:00Z" }] : [];
    let lineId = "", rejected = false, hpp: unknown;
    const query = {
      select: () => query, eq: (key: string, value: string) => { if (table === "sale_items" && key === "id" && hpp !== undefined) state.hppUpdates.push({ id: value, hpp }); return query; }, in: () => query, lte: () => query, gt: () => query, not: () => query, or: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales") state.headers.push(value); if (table === "sale_items") {
        state.events.push(`line:${value.item_id}`); rejected = value.item_id === state.rejectedItem;
        if (!rejected) { lineId = `line-${state.lines.length + 1}`; state.lines.push({ ...value, id: lineId }); }
      } return query; },
      update: (value: Record<string, unknown>) => { hpp = value.hpp; return query; },
      delete: () => query, single: async () => rejected ? ({ data: null, error: { message: "Pelaksana tidak aktif saat disimpan" } }) : ({ data: { id: lineId || "sale" }, error: null }), maybeSingle: async () => ({ data: table === "warehouses" && state.stock ? { id: "warehouse" } : table === "customers" && state.categoryPercent ? { category_id: "category", customer_categories: { diskon_persen: state.categoryPercent, rupiah_per_poin: 1000, is_active: true } } : null, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: rejected ? { message: "Pelaksana tidak aktif saat disimpan" } : null, count: data.length }).then(resolve),
    }; return query;
  },
}) }));
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";
beforeEach(() => { state.headers = []; state.lines = []; state.itemType = "Jasa"; state.employeeId = "login-employee"; state.promos = []; state.price = 100; state.categoryPercent = 0;
  state.stock = false; state.rpcCalls = []; state.rejectedItem = ""; state.events = []; state.hppUpdates = []; state.layerCost = 0; });
function form(performers: unknown = { doctor_id: "doctor", staff_id: "staff", doctor_name: "Forged name", branch_id: "forged" }) {
  const data = new FormData();
  Object.entries({ branchId: "branch", salespersonId: "forged-seller", metode: "Transfer", cart: JSON.stringify([
    { row_key: "row-1", item_id: "item", nama: "Jasa", qty: 1, harga: 100, satuan: "pcs", target_species: "Universal", item_type: "Jasa", service_performers: performers },
    { row_key: "row-2", item_id: "item", nama: "Jasa", qty: 1, harga: 100, satuan: "pcs", target_species: "Universal", service_performers: { doctor_id: null, staff_id: "different" } },
  ]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}
it("saves independent service rows with ID-only performers and derives cashier from login", async () => {
  expect(await checkoutSale(form()).catch(error => error.message)).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ cashier_id: "actor", cashier_name: "Kasir masuk", salesperson_id: "login-employee", total: 200 });
  expect(state.lines.map(line => line.service_performers)).toEqual([{ doctor_id: "doctor", staff_id: "staff" }, { doctor_id: null, staff_id: "different" }]);
  // A branch without an active warehouse never issued stock here; it finalizes directly as before.
  expect(state.rpcCalls.map(call => call.name)).toEqual(["finalize_pos_sale"]);
});
it("allows an authenticated cashier without an employee mapping", async () => {
  state.employeeId = null;
  expect(await checkoutSale(form()).catch(error => error.message)).toContain("/struk/sale");
  expect(state.headers[0].salesperson_id).toBeNull();
});
it("saves ID-only attribution on a physical product too, ignoring forged names and types", async () => {
  state.itemType = "Persediaan";
  expect(await checkoutSale(form()).catch(error => error.message)).toContain("/struk/sale");
  expect(state.lines.map(line => line.service_performers)).toEqual([{ doctor_id: "doctor", staff_id: "staff" }, { doctor_id: null, staff_id: "different" }]);
  expect(JSON.stringify(state.lines)).not.toContain("Forged name");
});
it("stores physical products with null performers when both role slots are blank", async () => {
  state.itemType = "Persediaan";
  const input = form(null);
  const rows = JSON.parse(String(input.get("cart"))).map((row: Record<string, unknown>) => ({ ...row, service_performers: { doctor_id: null, staff_id: null } }));
  input.set("cart", JSON.stringify(rows));
  expect(await checkoutSale(input).catch(error => error.message)).toContain("/struk/sale");
  expect(state.lines.map(line => line.service_performers)).toEqual([null, null]);
});
it.each([[], "bad", { doctor_id: "same", staff_id: "same" }].map(value => ({ value })))("rejects malformed service attribution $value before a sale is created", async ({ value }) => {
  expect(await checkoutSale(form(value)).catch(error => error.message)).not.toContain("/struk/");
  expect(state.headers).toHaveLength(0);
});

it.each([{ minQty: 2, maxQty: null, discount: 40 }, { minQty: 1, maxQty: 1, discount: 20 }])("preserves combined service promo rules and allocates source row discounts: $minQty/$maxQty", async ({ minQty, maxQty, discount }) => {
  state.promos = [{ id: "promo", name: "Promo jasa", itemIds: ["item"], minQty, maxQty, kelipatan: false, autoApply: true, discountType: "percent", discountValue: 20 }];
  expect(await checkoutSale(form()).catch(error => error.message)).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 200, total: 200 - discount, discount });
  expect(state.lines.reduce((sum, line) => sum + Number(line.promo_discount), 0)).toBe(discount);
});

it("preserves category discount rounding for separately attributed copies of one service", async () => {
  state.price = 99; state.categoryPercent = 33;
  const input = form(); input.set("customerId", "customer");
  expect(await checkoutSale(input).catch(error => error.message)).toContain("/struk/sale");
  expect(state.headers[0]).toMatchObject({ subtotal: 198, total: 133, diskon_kategori: 65 });
  expect(state.lines).toHaveLength(2);
});

function mixedForm(staffId = "staff") {
  const input = form();
  const rows = JSON.parse(String(input.get("cart")));
  input.set("cart", JSON.stringify([{ ...rows[0], item_id: "physical", item_type: "Persediaan", service_performers: null }, { ...rows[1], service_performers: { doctor_id: null, staff_id: staffId } }]));
  return input;
}
it("validates a later service actor against real branch staff before creating a mixed-cart sale or issuing stock", async () => {
  state.stock = true;
  expect(await checkoutSale(mixedForm("outside-branch")).catch(error => error.message)).not.toContain("/struk/");
  expect(state.rpcCalls).toEqual([]); expect(state.headers).toHaveLength(0); expect(state.lines).toHaveLength(0);
});
it("validates all pending source rows before any stock issue if the later service is rejected at database insertion", async () => {
  state.stock = true; state.rejectedItem = "item";
  expect(await checkoutSale(mixedForm()).catch(error => error.message)).not.toContain("/struk/");
  expect(state.rpcCalls).toEqual([]); expect(state.lines).toHaveLength(1);
});
it("posts mixed-cart stock, per-line HPP and payment in ONE database call after all source rows exist", async () => {
  state.stock = true;
  expect(await checkoutSale(mixedForm()).catch(error => error.message)).toContain("/struk/sale");
  expect(state.events).toEqual(["line:physical", "line:item", "rpc:pos_backoffice_post_atomic"]);
  expect(state.rpcCalls).toEqual([{ name: "pos_backoffice_post_atomic", args: { p_sale_id: "sale", p_warehouse_id: "warehouse" } }]);
  // FIFO cost is written by the database inside that same transaction, never by a separate client update.
  expect(state.hppUpdates).toEqual([]);
});
it("warns before saving goods below the FIFO cost and saves once that exact warning is confirmed (P03)", async () => {
  state.stock = true; state.layerCost = 150;
  const outcome = decodeURIComponent(await checkoutSale(mixedForm()).catch(error => error.message));
  expect(outcome).toContain("REDIRECT:/pos/transaksi?hpp_warning=");
  expect(outcome).toContain("Jasa (neto Rp100, HPP Rp150)");
  expect(state.headers).toHaveLength(0); expect(state.rpcCalls).toEqual([]);
  const signature = new URLSearchParams(outcome.slice(outcome.indexOf("?") + 1)).get("hpp_sig") ?? "";
  const confirmed = mixedForm(); confirmed.set(HPP_CONFIRM_FIELD, signature);
  expect(await checkoutSale(confirmed).catch(error => error.message)).toContain("/struk/sale");
  expect(state.headers).toHaveLength(1);
  expect(state.rpcCalls.map(call => call.name)).toEqual(["pos_backoffice_post_atomic"]);
});
