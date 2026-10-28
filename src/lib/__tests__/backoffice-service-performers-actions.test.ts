import { beforeEach, expect, it, vi } from "vitest";
import type { PromoHitung } from "@/lib/promo-hitung";

const state = vi.hoisted(() => ({ headers: [] as Record<string, unknown>[], lines: [] as Record<string, unknown>[], itemType: "Jasa", employeeId: "login-employee" as string | null, promos: [] as PromoHitung[], price: 100, categoryPercent: 0,
  stock: false, stockCalls: 0, rejectedItem: "", events: [] as string[], hppUpdates: [] as { id: string; hpp: unknown }[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/service-performers-server", async original => ({ ...await original<typeof import("@/lib/service-performers-server")>(), loggedInCashier: async () => ({ employeeId: state.employeeId, name: "Kasir masuk" }) }));
vi.mock("@/lib/pos-checkout-identity", () => ({ posCheckoutIdentity: () => ({ key: "draft", fingerprint: "fingerprint" }), resumePosCheckout: async () => {} }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-TEST" }) }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: async () => { state.stockCalls++; state.events.push("stock"); return { cost: 25 }; } }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => state.promos }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map(["item", "physical"].map(id => [id, [{ unit: "pcs", factor: 1, sell_price: state.price, buy_price: 0 }]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async () => ({ data: { sale_id: "sale", finalized: true }, error: null }),
  from(table: string) {
    const data = table === "items" ? [{ id: "item", item_type: state.itemType }, { id: "physical", item_type: "Persediaan" }]
      : table === "employees" ? [{ id: "doctor", nama: "Dokter", jabatan: "Dokter Hewan" }, { id: "staff", nama: "Staf", jabatan: "Groomer" }, { id: "different", nama: "Staf lain", jabatan: "Groomer" }] : [];
    let lineId = "", rejected = false, hpp: unknown;
    const query = {
      select: () => query, eq: (key: string, value: string) => { if (table === "sale_items" && key === "id" && hpp !== undefined) state.hppUpdates.push({ id: value, hpp }); return query; }, in: () => query, lte: () => query, order: () => query, range: () => query, limit: () => query,
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
  state.stock = false; state.stockCalls = 0; state.rejectedItem = ""; state.events = []; state.hppUpdates = []; });
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
  expect(state.stockCalls).toBe(0); expect(state.headers).toHaveLength(0); expect(state.lines).toHaveLength(0);
});
it("validates all pending source rows before any stock issue if the later service is rejected at database insertion", async () => {
  state.stock = true; state.rejectedItem = "item";
  expect(await checkoutSale(mixedForm()).catch(error => error.message)).not.toContain("/struk/");
  expect(state.stockCalls).toBe(0); expect(state.lines).toHaveLength(1);
});
it("issues mixed-cart stock only after all source rows exist and writes cost to those exact line IDs", async () => {
  state.stock = true;
  expect(await checkoutSale(mixedForm()).catch(error => error.message)).toContain("/struk/sale");
  expect(state.events.slice(0, 2)).toEqual(["line:physical", "line:item"]);
  expect(state.hppUpdates).toEqual([{ id: "line-1", hpp: 25 }, { id: "line-2", hpp: 25 }]);
});
