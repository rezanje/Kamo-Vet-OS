import { describe, expect, it } from "vitest";
import { consumeLayers } from "../inventory";

const L = (id: string, qty_left: number, unit_cost: number) => ({ id, qty_left, unit_cost });

describe("consumeLayers (FIFO)", () => {
  it("habiskan layer tertua dulu, cost campuran benar", () => {
    // 5 @1000 lalu 5 @2000; ambil 7 → 5×1000 + 2×2000 = 9000
    const { takes, cost, shortfall } = consumeLayers([L("a", 5, 1000), L("b", 5, 2000)], 7);
    expect(cost).toBe(9000);
    expect(shortfall).toBe(0);
    expect(takes).toEqual([
      { id: "a", qty: 5, unit_cost: 1000 },
      { id: "b", qty: 2, unit_cost: 2000 },
    ]);
  });

  it("qty pas satu layer", () => {
    const { takes, cost } = consumeLayers([L("a", 5, 1000)], 5);
    expect(cost).toBe(5000);
    expect(takes).toHaveLength(1);
  });

  it("layer kurang -> shortfall dilaporkan", () => {
    const { cost, shortfall } = consumeLayers([L("a", 3, 1000)], 10);
    expect(cost).toBe(3000);
    expect(shortfall).toBe(7);
  });

  it("tanpa layer -> semua shortfall", () => {
    expect(consumeLayers([], 4)).toEqual({ takes: [], cost: 0, shortfall: 4 });
  });

  it("layer kosong (qty_left 0) dilewati", () => {
    const { takes } = consumeLayers([L("a", 0, 1000), L("b", 5, 2000)], 2);
    expect(takes).toEqual([{ id: "b", qty: 2, unit_cost: 2000 }]);
  });
});
