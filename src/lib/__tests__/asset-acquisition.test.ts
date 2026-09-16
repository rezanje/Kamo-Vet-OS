import { describe, expect, it } from "vitest";
import { assertNewAssetFunding, assetPurchaseJournal } from "../asset-acquisition";

describe("assetPurchaseJournal", () => {
  it.each(["cash", "bank"] as const)("mendebit aset dan mengkredit rekening untuk %s", (source) => {
    const lines = assetPurchaseJournal(12_500_000, source, "110234");
    expect(lines).toEqual([
      { code: "1501", debit: 12_500_000, credit: 0 },
      { code: "110234", debit: 0, credit: 12_500_000 },
    ]);
  });

  it("mengkredit Hutang Usaha untuk pembelian termin", () => {
    expect(assetPurchaseJournal(5_000_000, "accounts_payable")).toEqual([
      { code: "1501", debit: 5_000_000, credit: 0 },
      { code: "2101", debit: 0, credit: 5_000_000 },
    ]);
  });

  it("menolak saldo awal sebagai sumber pembelian baru", () => {
    expect(() => assertNewAssetFunding("opening_balance")).toThrow(/Kas, Bank, atau Hutang Usaha/);
  });
});

