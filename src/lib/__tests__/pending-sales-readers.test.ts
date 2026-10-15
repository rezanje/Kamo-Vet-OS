import { expect, it } from "vitest";
import { getDashboard } from "../dashboard";
import { recomputeCustomerTier } from "../customer-tier";
import { kumpulkanBarisKomisi } from "../komisi-data";
import { jalankanPerawatanLoyalty } from "../loyalty-server";

function fakeClient() {
  const base = { id: "sale", total: 100000, customer_id: "c1", branch_id: "b1", cashier_id: "actor", salesperson_id: "employee", created_at: "2026-10-15T05:00:00Z",
    sale_items: [{ item_id: "item", qty: 1, harga: 100000, hpp: 50000, item_discount_type: null, item_discount_value: 0 }] };
  const sales = [base,
    { ...base, id: "final", payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: "2026-10-15T05:00:01Z" },
    { ...base, id: "pending", payment_plan: [{ method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 }], payments_finalized_at: null }];
  const updates: Record<string, unknown>[] = [];
  return { updates, from(table: string) {
    const data = table === "sales" ? sales : [];
    const result = { data, count: data.length, error: null };
    const q = { select: () => q, eq: () => q, is: () => q, not: () => q, neq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q,
      update: (value: Record<string, unknown>) => { updates.push(value); return q; },
      range: async () => result, maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
  } };
}

it("financial dashboard sales and trend include completed legacy and planned sales only", async () => {
  const result = await getDashboard(fakeClient(), "2026-10-15");
  expect(result.penjualan.total).toBe(200000);
  expect(result.trenPenjualan.find(day => day.tanggal === "2026-10-15")?.total).toBe(200000);
});

it("customer spending and tier do not include an unfinished planned checkout", async () => {
  const client = fakeClient();
  await recomputeCustomerTier(client as never, "c1");
  expect(client.updates).toEqual([{ total_spending: 200000, tier: "New" }]);
});

it("commission includes each completed sale once and excludes pending line items", async () => {
  const result = await kumpulkanBarisKomisi(fakeClient(), "2026-10");
  expect(result.baris).toHaveLength(2);
  expect(result.baris.reduce((sum, row) => sum + row.omzet, 0)).toBe(200000);
});

it("does not let an unfinished sale reset the customer's inactivity period", async () => {
  const client = { from(table: string) {
    const rows = table === "customers" ? [{ id: "customer", tier: "Bronze", tier_downgraded_at: null }]
      : table === "sales" ? [{ customer_id: "customer", created_at: "2025-01-01" },
        { customer_id: "customer", created_at: "2026-10-14", payment_plan: [{ method: "Tunai", amount: 100000 }], payments_finalized_at: null }] : [];
    const q = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, update: () => q,
      maybeSingle: async () => ({ data: { points_expiry_enabled: false, tier_downgrade_enabled: true, tier_downgrade_days: 180 }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) };
    return q;
  } };
  expect((await jalankanPerawatanLoyalty(client, new Date("2026-10-15T05:00:00Z"))).downgradedCustomers).toBe(1);
});
