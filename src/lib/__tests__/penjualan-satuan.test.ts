import { describe, expect, it } from "vitest";
import { cocokkanSatuanJual } from "../penjualan-satuan";

const item = [{ id: "a", name: "Obat", unit: "pcs", sell_price: 1000 }];
const extra = [{ item_id: "a", unit: "box", factor: 12, sell_price: 11000, buy_price: 8000 }];
const row = { item_id: "a", nama: "A — Obat", qty: 2, harga: 11000, satuan: "box", faktor: 12 };

describe("cocokkanSatuanJual", () => {
  it("accepts a master unit without altering its stored price or stock factor", () => {
    expect(cocokkanSatuanJual([row], item, extra)).toEqual({ rows: [row], error: null });
  });

  it("rejects a forged or stale factor instead of silently selling a box as one piece", () => {
    expect(cocokkanSatuanJual([{ ...row, faktor: 1 }], item, extra).error).toMatch(/faktor/);
  });

  it("rejects deleted units and inactive items", () => {
    expect(cocokkanSatuanJual([row], item, []).error).toMatch(/Satuan/);
    expect(cocokkanSatuanJual([row], [], extra).error).toMatch(/tidak aktif/);
  });

  it("keeps free-text service lines without an inventory factor", () => {
    expect(cocokkanSatuanJual([{ ...row, item_id: null, satuan: "box" }], [], []).rows[0]).toMatchObject({ item_id: null, satuan: null, faktor: 1 });
  });
});
