import { expect, it } from "vitest";
import { parseBlocked } from "@/lib/stock-correction-blocked";

it("reads an array or its JSON text and keeps only known fields", () => {
  const row = { item_id: "i", name: "TH4", old_qty: 1000, new_qty: 1, reason: "Stok sudah terpakai", extra: "x" };
  expect(parseBlocked([row])).toEqual([{ item_id: "i", name: "TH4", old_qty: 1000, new_qty: 1, reason: "Stok sudah terpakai" }]);
  expect(parseBlocked(JSON.stringify([row]))).toEqual([{ item_id: "i", name: "TH4", old_qty: 1000, new_qty: 1, reason: "Stok sudah terpakai" }]);
  expect(parseBlocked([{ name: "A", reason: "B" }])).toEqual([{ name: "A", reason: "B" }]);
  expect(parseBlocked([])).toEqual([]);
});
it("rejects anything that is not a list of {name, reason} text pairs", () => {
  for (const bad of [undefined, null, 5, "bukan json", "{}", {}, [{ name: "A" }], [{ name: 1, reason: "x" }], [null], [{ name: "A", reason: "B" }, 3]]) expect(parseBlocked(bad)).toBeUndefined();
});
