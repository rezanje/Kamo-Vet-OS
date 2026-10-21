import { expect, it } from "vitest";
import { loadInventoryClosing } from "../inventory-closing";
import { clientFixture } from "./fixtures/hpp-report-client";

it("shows immutable snapshot values only for accessible branches", async () => {
  const result = await loadInventoryClosing(clientFixture({ averageMode: true, deniedBranch: "b2", tables: {
    warehouses: [{ id: "w1", branch_id: "b1", name: "Utama" }, { id: "w2", branch_id: "b2", name: "Rahasia" }],
    inventory_costing_settings: [{ id: true, method: "moving_average", activated_at: "2026-10-01T00:00:00Z" }],
    inventory_month_closes: [{ id: "c1", period: "2026-09-01", closed_through: "2026-09-30", closed_at: "2026-10-01T00:00:00Z", snapshot_count: 2, total_value: 999 }],
    inventory_month_values: [{ close_id: "c1", warehouse_id: "w1", item_id: "i", qty: 2, average_cost: 80, value: 160 }, { close_id: "c1", warehouse_id: "w2", item_id: "i", qty: 1, average_cost: 839, value: 839 }],
    stock: [{ id: "s", warehouse_id: "w1", item_id: "i", qty: 2, average_cost: 200 }],
  } }).client);
  expect(result.allBranches).toBe(false);
  expect(result.history[0]).toMatchObject({ scopedCount: 1, scopedValue: 160 });
  expect(result.values).toHaveLength(1);
  expect(result.values[0]).toMatchObject({ average_cost: 80, value: 160, warehouse: "Utama" });
});

it("denies nonfinancial roles and fails closed on incomplete snapshot reads", async () => {
  await expect(loadInventoryClosing(clientFixture({ role: "ADMIN" }).client)).rejects.toMatchObject({ status: 403 });
  await expect(loadInventoryClosing(clientFixture({ errorTable: "inventory_month_closes" }).client)).rejects.toThrow("read failed");
});
