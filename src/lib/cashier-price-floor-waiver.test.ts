import { describe, expect, it } from "vitest";
import { cashierPriceFloorIssue, priceFloorFindings } from "./cashier-price-floor";
import { hppWarningsFrom } from "./hpp-warning";

// Stage 3b: the TS price floor honours the Owner below-HPP waiver exactly like the DB (P05_PROMO_WAIVER):
//   waived line floor = least(hpp, gross - promo_discount); net must stay > 0; hpp unknown still refuses;
//   a receipt-level reduction (voucher / points / total discount) below the after-promo subtotal refuses.
const goods = (harga: number, promo = 0, qty = 1, nama = "ANC Creamy") => ({ nama, item_type: "Persediaan", qty, harga, faktor: 1, promo_discount: promo });

describe("priceFloorFindings with waived[]", () => {
  it("a waived reward line sold below cost with an untouched receipt is information (below_waived), not a refusal", () => {
    const lines = [goods(15000, 6000)]; // net 9000, hpp 10000
    const f = priceFloorFindings(lines, 9000, [10000], [true]);
    expect(f).toEqual([{ index: 0, nama: "ANC Creamy", paket: false, kind: "below_waived", net: 9000, hpp: 10000 }]);
    expect(cashierPriceFloorIssue(lines, 9000, [10000], [true])).toBeNull();
  });
  it("the same line WITHOUT the waiver is refused (unchanged behaviour)", () => {
    expect(cashierPriceFloorIssue([goods(15000, 6000)], 9000, [10000])).toContain("HPP");
    expect(cashierPriceFloorIssue([goods(15000, 6000)], 9000, [10000], [false])).toContain("HPP");
  });
  it("receipt-level discount (voucher/points/total) on top of a waived below-cost line is refused with a specific message", () => {
    const issue = cashierPriceFloorIssue([goods(15000, 6000)], 8000, [10000], [true]);
    expect(issue).toMatch(/voucher.*poin.*diskon total/i);
    expect(priceFloorFindings([goods(15000, 6000)], 8000, [10000], [true])[0]).toMatchObject({ kind: "below", waived: true });
  });
  it("a waived line whose promo price is at/above cost keeps the ordinary floor (floor = hpp): a receipt discount that pushes it under cost is refused", () => {
    expect(cashierPriceFloorIssue([goods(15000, 1000)], 14000, [10000], [true])).toBeNull();
    expect(cashierPriceFloorIssue([goods(15000, 1000)], 9000, [10000], [true])).toContain("HPP");
  });
  it("net 0 and unknown cost still refuse on a waived line (the waiver never allows free goods or unverifiable cost)", () => {
    expect(cashierPriceFloorIssue([goods(15000, 15000)], 0, [10000], [true])).toContain("nol");
    expect(cashierPriceFloorIssue([goods(15000, 6000)], 9000, [null], [true])).toContain("HPP aktif");
  });
  it("only flagged lines are relaxed: another goods line below cost in the same receipt is still refused", () => {
    const lines = [goods(15000, 6000), goods(9000, 0, 1, "Kopi")];
    expect(cashierPriceFloorIssue(lines, 18000, [10000, 9500], [true, false])).toContain("Kopi");
  });
  it("waived[] is optional and positional (absent / shorter array = nothing waived)", () => {
    const lines = [goods(15000, 6000), goods(9000)];
    expect(priceFloorFindings(lines, 18000, [10000, 8000]).map((f) => f.kind)).toEqual(["below"]);
    expect(priceFloorFindings(lines, 18000, [10000, 8000], [true]).map((f) => f.kind)).toEqual(["below_waived"]);
  });
  it("the POS warning list ignores the informational below_waived finding (no confirmation box for an Owner-approved promo)", () => {
    const f = priceFloorFindings([goods(15000, 6000), goods(9000, 0, 1, "Kopi")], 18000, [10000, 9500], [true, false]);
    expect(f.map((x) => x.kind).sort()).toEqual(["below", "below_waived"]);
    expect(hppWarningsFrom(f).map((w) => w.nama)).toEqual(["Kopi"]);
  });
});
