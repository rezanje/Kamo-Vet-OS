import { describe, expect, it } from "vitest";
import { inventoryBasisRows } from "../accurate-inventory-basis";

const source = (item: string, warehouse: string, qty: string, cost: string) => ({
  status: "posted", code: item, payload: { item_id: item, warehouse_id: warehouse, base_qty: qty, base_unit_cost: cost },
});
const layer = (item: string, warehouse: string, qty: string, cost: string) => ({ item_id: item, warehouse_id: warehouse, qty_in: qty, unit_cost: cost });
const move = (item: string, warehouse: string, qty: string, cost: string) => ({ item_id: item, warehouse_id: warehouse, qty, unit_cost: cost });

describe("inventoryBasisRows", () => {
  it("reconciles each item and warehouse independently with exact decimal values", () => {
    const result = inventoryBasisRows({ status: "posted", selected_rows: 3, evidence: {
      rows: [source("A", "W1", "1.2", "0.025"), source("A", "W1", "2", "1"), source("B", "W2", "4", "10")],
      source_layers: [layer("A", "W1", "1.2", "0.025"), layer("A", "W1", "2", "1"), layer("B", "W2", "4", "10")],
      source_moves: [move("A", "W1", "1.2", "0.025"), move("A", "W1", "2", "1"), move("B", "W2", "4", "10")],
    } });
    expect(result.complete).toBe(true);
    expect(result.rows).toMatchObject([
      { code: "A", warehouseId: "W1", sourceQty: "3.2", sourceValue: "2.03", layerQty: "3.2", moveQty: "3.2", status: "match" },
      { code: "B", warehouseId: "W2", sourceQty: "4", sourceValue: "40", layerQty: "4", moveQty: "4", status: "match" },
    ]);
  });

  it("flags a per-key difference even when total quantity and value cancel out", () => {
    const result = inventoryBasisRows({ status: "posted", selected_rows: 2, evidence: {
      rows: [source("A", "W1", "1", "10"), source("B", "W1", "1", "10")],
      source_layers: [layer("A", "W1", "2", "10")],
      source_moves: [move("B", "W1", "2", "10")],
    } });
    expect(result.complete).toBe(true);
    expect(result.rows.map(row => row.status)).toEqual(["mismatch", "mismatch"]);
  });

  it("includes unexpected posted keys and keeps unposted batches pending", () => {
    const evidence = { rows: [source("A", "W1", "1", "10")], source_layers: [layer("X", "W2", "1", "10")], source_moves: [] };
    const posted = inventoryBasisRows({ status: "posted", selected_rows: 1, evidence });
    expect(posted.rows.find(row => row.code === "X")?.status).toBe("mismatch");
    const preview = inventoryBasisRows({ status: "previewed", selected_rows: 1, evidence: { ...evidence, rows: [{ ...evidence.rows[0], status: "valid" }], source_layers: [], source_moves: [] } });
    expect(preview.rows[0].status).toBe("pending");
  });

  it("does not claim a match when source evidence is missing or malformed", () => {
    expect(inventoryBasisRows({ status: "posted", selected_rows: 1, evidence: { rows: [], source_layers: [], source_moves: [] } }).complete).toBe(false);
    expect(inventoryBasisRows({ status: "posted", selected_rows: 1, evidence: { rows: [source("A", "W1", "bad", "10")], source_layers: [], source_moves: [] } }).complete).toBe(false);
  });
});
