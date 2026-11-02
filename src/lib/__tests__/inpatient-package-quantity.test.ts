import { expect, it } from "vitest";
import { resizeInpatientPackage } from "@/lib/inpatient-cashier";
const rows = [
  { key: "source-jasa", item_id: "jasa", jenis: "jasa", qty: 2, harga: 110700, satuan: "x", package_item_id: "package", package_qty: 2, service_performers: { doctor_id: "saved" } },
  { key: "source-material", item_id: "material", jenis: "obat", qty: 2, harga: 12300, satuan: "box", package_item_id: "package", package_qty: 2 },
  { key: "ordinary-same-sku", item_id: "material", jenis: "obat", qty: 1, harga: 1000, satuan: "pcs", package_item_id: null, package_qty: null },
  { key: "racik", item_id: null, jenis: "obat", qty: 1, harga: 5000, satuan: "racikan", recipe_id: "old-racik" },
];
it("resizes all explicit package source kinds without reallocating prices, changing IDs/conversions/performers or touching ordinary/racikan rows", () => {
  const next = resizeInpatientPackage(rows, "package", 3);
  expect(next.slice(0, 2)).toEqual(rows.slice(0, 2).map(row => ({ ...row, qty: 3, package_qty: 3 })));
  expect(next[2]).toBe(rows[2]); expect(next[3]).toBe(rows[3]);
  expect(rows[0].qty).toBe(2);
  expect(resizeInpatientPackage(next, "package", 1).slice(0, 2).map(row => row.qty)).toEqual([1, 1]);
});
it.each([0, -1, 1.5, NaN, Infinity])("ignores invalid package count %s", count => { expect(resizeInpatientPackage(rows, "package", count)).toBe(rows); });
it("never resizes an incoherent saved package set", () => {
  const bad = rows.map((row, i) => i === 0 ? { ...row, package_qty: null } : row);
  expect(resizeInpatientPackage(bad, "package", 3)).toBe(bad);
});
