import { expect, it } from "vitest";
import { clinicPackageOriginInput } from "@/lib/clinic-package-origin";
const id = "ABCDEF12-abcd-4abc-8abc-abcdef123456";
const component = { item_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nama_obat: "Component", jenis: "jasa" };
it.each([{}, { package_item_id: null, package_qty: null }, { paket_id: null, paket_qty: null }])("does not infer origin or add NULL keys: %j", origin => {
  expect(clinicPackageOriginInput({ ...component, ...origin, nama_obat: "Package-looking name", harga: 100, ingredients: [{ item_id: component.item_id, qty: 2 }] })).toStrictEqual({});
});
it.each([
  { package_item_id: id, package_qty: 2 },
  { paket_id: id, paket_qty: 2 },
  { package_item_id: id, package_qty: 2, paket_id: id, paket_qty: 2 },
])("returns literal canonical intent without mutating caller: %j", origin => {
  const row = Object.freeze({ ...component, ...origin });
  expect(clinicPackageOriginInput(row)).toStrictEqual({ package_item_id: id, package_qty: 2 });
});
it.each([
  { package_item_id: id }, { package_qty: 2 }, { paket_id: id }, { paket_qty: 2 },
  { package_item_id: id, paket_qty: 2 },
  { package_item_id: ` ${id}`, package_qty: 2 },
  { package_item_id: `${id} `, package_qty: 2 },
  { package_item_id: id.replaceAll("-", ""), package_qty: 2 },
  { package_item_id: "not-uuid", package_qty: 2 },
  { package_item_id: 42, package_qty: 2 },
  ...[0, -1, 1.5, "2", true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(package_qty => ({ package_item_id: id, package_qty })),
  { package_item_id: id, package_qty: 2, paket_id: id.toLowerCase(), paket_qty: 2 },
  { package_item_id: id, package_qty: 2, paket_id: id, paket_qty: 3 },
  { package_item_id: id, package_qty: 2, paket_id: "" },
])("rejects malformed, incomplete and conflicting claims: %j", origin => {
  expect(() => clinicPackageOriginInput({ ...component, ...origin })).toThrow("Asal paket tidak valid");
});
it.each([{ item_id: null }, { item_id: "" }, { item_id: "bad-id" }, { jenis: "racikan" }, { compound_recipe_id: "recipe" }, { nama_obat: "  " }])("rejects orphan or unsupported compound origin: %j", patch => {
  expect(() => clinicPackageOriginInput({ ...component, ...patch, paket_id: id, paket_qty: 1 })).toThrow("Asal paket tidak valid");
});
it.each([null, false, 1, "row", []].map(row => [row]))("rejects malformed rows through a controlled error: %j", row => {
  expect(() => clinicPackageOriginInput(row)).toThrow("Asal paket tidak valid");
});
