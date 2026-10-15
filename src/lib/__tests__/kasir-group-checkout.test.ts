import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ snapshots: [] as Record<string, unknown>[], failPage: -1 }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-TEST" }) }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => {} }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async () => "1101" }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), splitPpnInklusif: () => ({}) }));
vi.mock("@/lib/penjualan-jurnal", () => ({ jurnalPenjualanInklusif: () => [] }));
vi.mock("@/lib/promo-hitung", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/satuan")>(),
  loadUnitOptions: async (_client: unknown, ids: string[]) => new Map(ids.map(id => [id, [{ unit: "pcs", factor: 1, sell_price: 1000, buy_price: 0 }]])),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
  from(table: string) {
    const group = { id: "group", code: "GRUP", name: "Paket", nama: "Paket", unit: "pcs", item_type: "Grup", sell_price: 1000, min_sell_qty: 1, is_active: true };
    const components = Array.from({ length: 1002 }, (_, index) => ({
      id: `component-${index}`, code: `C-${index}`, name: `Jasa ${index}`, item_type: "Jasa", is_active: true,
    }));
    let rows: Record<string, unknown>[] = table === "items" ? [group, ...components]
      : table === "item_group_components" ? components.map((component, index) => ({
        id: `recipe-${index}`, group_item_id: "group", component_item_id: component.id, qty: 1, unit: "pcs", factor: 1, sort_order: index, component,
      })) : [];
    let from = 0; let to = 999; let count = false;
    const single = () => ({ data: table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? null : { id: table === "sales" ? "sale" : "sale-item" }, error: null });
    const query = {
      select: (_fields: string, options?: { count: string }) => { count = options?.count === "exact"; return query; },
      eq: () => query, order: () => query, limit: () => query,
      in: (column: string, ids: string[]) => { rows = rows.filter(row => ids.includes(row[column] as string)); return query; },
      range: (start: number, end: number) => { from = start; to = end; return query; },
      insert: (values: Record<string, unknown>[]) => { if (table === "sale_item_group_components") state.snapshots.push(...values); return query; },
      update: () => query, delete: () => query,
      maybeSingle: async () => single(), single: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(from, to + 1), count: count ? rows.length : null,
        error: table === "item_group_components" && from === state.failPage ? { message: "later group page failed" } : null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";

beforeEach(() => { state.snapshots = []; state.failPage = -1; });
function form() {
  const data = new FormData();
  Object.entries({ customerId: "customer", salespersonId: "seller", metode: "Debit", operationalShiftId: "shift", checkout_key: "checkout-identity",
    cart: JSON.stringify([{ item_id: "group", nama: "Paket", qty: 1, harga: 1000, satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}
it("saves the full group breakdown and acknowledges the exact completed cashier draft", async () => {
  await expect(checkoutKasir(form())).rejects.toThrow("REDIRECT:/kasir/struk/sale?print=1&draft_done=checkout-identity");
  expect(state.snapshots).toHaveLength(1002);
  expect(state.snapshots.at(-1)?.component_item_id).toBe("component-1001");
});

it("does not issue a receipt when a later group component page cannot be verified", async () => {
  state.failPage = 500;
  const result = await checkoutKasir(form()).then(() => "success", error => error.message);
  expect(result).not.toContain("/struk/");
  expect(result).toMatch(/belum.*dimuat/);
  expect(state.snapshots).toHaveLength(0);
});
