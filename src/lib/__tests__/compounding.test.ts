import { describe, expect, it } from "vitest";
import { canEditRecipe, nextStatus, stockDeductions } from "../compounding";

describe("canEditRecipe", () => {
  it("only pending is editable", () => {
    expect(canEditRecipe("pending")).toBe(true);
    expect(canEditRecipe("ready")).toBe(false);
    expect(canEditRecipe("handed_over")).toBe(false);
    expect(canEditRecipe("void")).toBe(false);
  });
});

describe("nextStatus", () => {
  it("walks pending → ready → handed_over → null", () => {
    expect(nextStatus("pending")).toBe("ready");
    expect(nextStatus("ready")).toBe("handed_over");
    expect(nextStatus("handed_over")).toBeNull();
    expect(nextStatus("void")).toBeNull();
  });
});

describe("stockDeductions", () => {
  it("aggregates duplicate items and skips non-inventory ingredients", () => {
    const d = stockDeductions([
      { item_id: "A", quantity: 2 },
      { item_id: null, quantity: 5 },
      { item_id: "A", quantity: 3 },
      { item_id: "B", quantity: 1 },
    ]);
    expect(d).toEqual([
      { item_id: "A", qty: 5 },
      { item_id: "B", qty: 1 },
    ]);
  });
  it("empty input → empty output", () => {
    expect(stockDeductions([])).toEqual([]);
  });
});
