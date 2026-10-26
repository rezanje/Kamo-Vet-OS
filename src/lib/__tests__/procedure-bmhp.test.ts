import { describe, expect, it } from "vitest";
import { bmhpInput } from "../procedure-bmhp";

describe("K02 procedure BMHP input", () => {
  it("passes only IDs, quantities and units to the database", () => {
    expect(bmhpInput([{ item_id: " syr ", qty: "2", unit: "pcs", nama: "Forged", cost: 1 }])).toEqual([{ item_id: "syr", qty: 2, unit: "pcs" }]);
    expect(bmhpInput(undefined)).toEqual([]);
  });
  it.each([
    [[{ item_id: "a", qty: 0, unit: "pcs" }]],
    [[{ item_id: "a", qty: Number.NaN, unit: "pcs" }]],
    [[{ item_id: "", qty: 1, unit: "pcs" }]],
    [[{ item_id: "a", qty: 1, unit: "" }]],
    [[{ item_id: "a", qty: 1, unit: "pcs" }, { item_id: "a", qty: 2, unit: "pcs" }]],
    [{ item_id: "a" }],
    [Array.from({ length: 51 }, (_, i) => ({ item_id: `x${i}`, qty: 1, unit: "pcs" }))],
  ])("rejects invalid usage %#", value => {
    expect(() => bmhpInput(value)).toThrow();
  });
});
