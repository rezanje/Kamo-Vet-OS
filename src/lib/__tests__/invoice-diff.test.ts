import { describe, expect, it } from "vitest";
import { diffInvoice, requiresReason, type InvoiceSnapshot } from "../invoice-diff";

const base: InvoiceSnapshot = {
  subtotal: 100000, discount: 0, tax: 11000, total: 111000,
  paid_status: "Belum Lunas", metode_bayar: "Tunai",
  items: [{ deskripsi: "Jasa Konsultasi", qty: 1, harga: 100000 }],
};

describe("diffInvoice", () => {
  it("no changes → empty diff", () => {
    expect(diffInvoice(base, { ...base, items: [...base.items] })).toEqual([]);
  });
  it("detects single scalar change", () => {
    const d = diffInvoice(base, { ...base, discount: 5000 });
    expect(d).toEqual([{ field_changed: "discount", old_value: "0", new_value: "5000" }]);
  });
  it("detects item changes with readable serialization", () => {
    const d = diffInvoice(base, { ...base, items: [{ deskripsi: "Jasa Konsultasi", qty: 2, harga: 100000 }] });
    expect(d).toHaveLength(1);
    expect(d[0].field_changed).toBe("items");
    expect(d[0].old_value).toBe("Jasa Konsultasi x1 @100000");
    expect(d[0].new_value).toBe("Jasa Konsultasi x2 @100000");
  });
  it("detects multiple changes at once", () => {
    const d = diffInvoice(base, { ...base, total: 200000, paid_status: "DP" });
    expect(d.map((x) => x.field_changed).sort()).toEqual(["paid_status", "total"]);
  });
});

describe("requiresReason", () => {
  it("money fields require reason", () => {
    expect(requiresReason([{ field_changed: "total", old_value: "1", new_value: "2" }])).toBe(true);
    expect(requiresReason([{ field_changed: "items", old_value: "a", new_value: "b" }])).toBe(true);
  });
  it("non-money fields do not", () => {
    expect(requiresReason([{ field_changed: "metode_bayar", old_value: "Tunai", new_value: "QRIS" }])).toBe(false);
  });
});
