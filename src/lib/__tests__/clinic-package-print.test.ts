import { describe, expect, it } from "vitest";
import { customerPackageLines, type PackagePrintSource } from "../clinic-package-print";
const material = { item_id: "same-sku", invoice_id: "one", deskripsi: "Internal material", qty: 2, harga: 5000, diskon_persen: 10, package_item_id: "same-group", package_qty: 1, package: { name: "Saved package" } };
const service = { ...material, deskripsi: "Internal service", qty: 1, harga: 290000, diskon_persen: 0 };
describe("customer print projection", () => {
  it("retains original source references/tags, same-SKU standalone lines, cross-invoice scope and mixed net discounts", () => {
    const standalone = { ...material, package_item_id: null, package_qty: null };
    const otherInvoice = { ...material, invoice_id: "two" };
    const rows = [material, service, standalone, otherInvoice];
    const before = JSON.stringify(rows);
    const out = customerPackageLines(rows);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ deskripsi: "Saved package", qty: 1, harga: 300000, jumlah: 299000, diskon: 1000, diskon_persen: null });
    expect(out[0].sources[0]).toBe(material); expect(out[0].sources[1]).toBe(service);
    expect(out[1]).toMatchObject({ deskripsi: "Internal material", jumlah: 9000 });
    expect(out[2]).toMatchObject({ deskripsi: "Saved package", jumlah: 9000 });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("sums original line prices, not a package master price, preserving quantity and uniform discounts", () => {
    const out = customerPackageLines([{ ...material, package_qty: 2 }, { ...service, package_qty: 2, diskon_persen: 10 }], { subtotal: 270000 });
    expect(out[0]).toMatchObject({ qty: 2, harga: 150000, jumlah: 270000, diskon_persen: 10, diskon: 30000 });
  });
  it("accepts true zero and cent-rounded saved subtotals without comparing invoice tax/transaction discounts", () => {
    expect(customerPackageLines([], { subtotal: 0 })).toEqual([]);
    expect(customerPackageLines([{ deskripsi: "Fractional original net", qty: 1, harga: 0.11, diskon_persen: 10 }], { subtotal: 0.10 })[0].jumlah).toBeCloseTo(0.099);
  });
  it("rounds only the sum of original net lines, not each source or grouped display row", () => {
    const line = { deskripsi: "Original fraction", qty: 1, harga: 0.05, diskon_persen: 50 };
    expect(customerPackageLines([line, line], { subtotal: 0.05 }).map(row => row.jumlah)).toEqual([0.025, 0.025]);
  });
  it("accepts legitimate half-cent PostgreSQL subtotal rounding without binary Math.round drift", () => {
    expect(customerPackageLines([{ deskripsi: "Original half-cent net", qty: 1, harga: 0.29, diskon_persen: 50 }], { subtotal: 0.15 })[0].jumlah).toBeCloseTo(0.145);
  });
  it.each([
    { qty: 1, harga: 1.15, diskon_persen: 90, subtotal: 0.12 },
    { qty: "1", harga: "1.15", diskon_persen: "90", subtotal: "0.12" },
  ])("verifies source-decimal half cents before any Number arithmetic: %j", ({ subtotal, ...values }) => {
    const row = { deskripsi: "Exact source net 0.115", ...values } as unknown as PackagePrintSource;
    expect(customerPackageLines([row], { subtotal })[0].jumlah).toBeCloseTo(0.115);
    expect(() => customerPackageLines([row], { subtotal: "0.11" })).toThrow(/subtotal/i);
  });
  it("verifies unrounded multiline source-decimal sums in every order, preserving per-invoice display nets", () => {
    const rows = [
      { deskripsi: "Discounted half cent", qty: 1, harga: 1.15, diskon_persen: 90 },
      { deskripsi: "Ordinary decimal", qty: 1, harga: 0.10 },
      { deskripsi: "Ordinary decimal", qty: 1, harga: 0.20 },
    ];
    for (const order of [rows, [...rows].reverse(), [rows[0], rows[2], rows[1]]]) {
      const out = customerPackageLines(order, { subtotal: "0.42" });
      expect(out.reduce((sum, line) => sum + line.jumlah, 0)).toBeCloseTo(0.415);
      expect(out.flatMap(line => line.sources)).toEqual(order);
      expect(() => customerPackageLines(order, { subtotal: "0.41" })).toThrow(/subtotal/i);
    }
  });
  it.each([null, undefined, "", " ", NaN, Infinity, {}, false])("rejects unknown/invalid saved subtotal %s", subtotal => {
    expect(() => customerPackageLines([], { subtotal })).toThrow(/subtotal|verifikasi/i);
  });
  it.each([
    { package: null }, { package: { name: " " } }, { package_qty: null }, { package_qty: 0 }, { package_qty: Infinity },
  ])("rejects unverifiable persisted package metadata %j", changed => {
    expect(() => customerPackageLines([{ ...material, ...changed }])).toThrow(/paket/i);
  });
  it.each([{ package_qty: 2 }, { package: { name: "Other package" } }])("rejects inconsistent group metadata %j", changed => {
    expect(() => customerPackageLines([material, { ...service, ...changed }])).toThrow(/konsisten/i);
  });
  it("rejects ambiguous joined package names instead of selecting an arbitrary first relation", () => {
    expect(() => customerPackageLines([{ ...material, package: [{ name: "Saved package" }, { name: "Other package" }] }])).toThrow(/paket/i);
  });
  it.each([{ qty: null }, { harga: null }, { harga: Infinity }, { diskon_persen: NaN }, { diskon_persen: Infinity }])("rejects unknown/nonfinite source money %j instead of coercing it", changed => {
    expect(() => customerPackageLines([{ ...material, ...changed } as unknown as PackagePrintSource])).toThrow(/verifikasi/i);
  });
});
