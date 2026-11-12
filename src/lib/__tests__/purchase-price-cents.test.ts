import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { purchaseLineCentsProblem } from "@/lib/purchase-price-cents";

describe("purchaseLineCentsProblem", () => {
  it("menolak harga lebih dari 2 desimal (kasus PO-20261102-DC-0004)", () => {
    expect(purchaseLineCentsProblem(360, 541.666667)).toMatch(/2 angka/);
    expect(purchaseLineCentsProblem(225, 222.225)).toMatch(/2 angka/);
  });
  it("menolak qty pecahan yang membuat nilai baris di bawah sen", () => {
    expect(purchaseLineCentsProblem(0.5, 3333.33)).toMatch(/sen/);
  });
  it("menerima harga sen biasa dan harga per botol", () => {
    expect(purchaseLineCentsProblem(36, 3333.33)).toBeNull();
    expect(purchaseLineCentsProblem(6, 32500)).toBeNull();
    expect(purchaseLineCentsProblem(225, 222.23)).toBeNull();
    expect(purchaseLineCentsProblem(0, 0)).toBeNull();
  });
  it("penjaga database ikut dipasang untuk semua jalur tulis baris PO", () => {
    const sql = readFileSync("supabase/migrations/20261117100000_harga_po_maksimal_2_desimal.sql", "utf8");
    expect(sql).toMatch(/before insert or update of harga_beli,qty on public\.purchase_order_items/);
    expect(sql).toMatch(/new\.harga_beli<>round\(new\.harga_beli,2\)/);
    expect(sql).toMatch(/new\.qty\*new\.harga_beli<>round\(new\.qty\*new\.harga_beli,2\)/);
  });
});
