import { describe, expect, it } from "vitest";
import { pesanPilihanPromo } from "../promo-pick-note";

// Catatan pilihan promo kasir untuk struk / pratinjau: hanya pilihan eksplisit yang dicatat.
describe("pesanPilihanPromo", () => {
  it("'tanpa' -> the clear cancellation note", () => {
    expect(pesanPilihanPromo("tanpa", null)).toBe("Promo dibatalkan oleh kasir");
  });
  it("'pilih' with the stored name -> says which promo the cashier picked (exclusive)", () => {
    expect(pesanPilihanPromo("pilih", { applied: [{ promo_id: "sh1", name: "Beli 2 Bolt, ANC", discount: 1000 }] })).toBe("Promo dipilih kasir: Beli 2 Bolt, ANC (hanya promo ini)");
  });
  it("'pilih' without a readable name -> generic wording, never throws on a malformed selection", () => {
    for (const sel of [null, undefined, {}, { applied: null }, { applied: [] }, { applied: [{}] }, { applied: "x" }, 42, "x"]) {
      expect(pesanPilihanPromo("pilih", sel as never)).toBe("Promo dipilih kasir (hanya promo ini)");
    }
  });
  it("'auto', null and anything unknown -> no note (receipts of automatic / old sales stay as they were)", () => {
    for (const m of ["auto", null, undefined, "", "other", 1]) expect(pesanPilihanPromo(m as never, null)).toBeNull();
  });
  it("a long or hostile promo name is cut and has no markup meaning (plain string)", () => {
    const out = pesanPilihanPromo("pilih", { applied: [{ name: "<b>" + "x".repeat(300) }] })!;
    expect(out.length).toBeLessThan(140);
  });
});
