import { describe, expect, it } from "vitest";
import { assetPurchaseJournal, assertNewAssetFunding } from "../asset-acquisition";

describe("asset purchase accounting", () => {
  it("posts the purchase value to fixed assets and the selected funding account", () => {
    expect(assetPurchaseJournal(1250000.5, "Bank", "1108")).toEqual([
      { code: "1501", debit: 1250000.5, credit: 0 },
      { code: "1108", debit: 0, credit: 1250000.5 },
    ]);
  });

  it("accepts only cash or bank for new purchases", () => {
    expect(() => assertNewAssetFunding("Tunai")).not.toThrow();
    expect(() => assertNewAssetFunding("Bank")).not.toThrow();
    expect(() => assertNewAssetFunding("saldo-awal")).toThrow("Pembelian baru wajib memakai Kas atau Bank");
    expect(() => assertNewAssetFunding("accounts_payable")).toThrow("Pembelian baru wajib memakai Kas atau Bank");
  });

  it("rejects non-positive or non-finite purchase values", () => {
    expect(() => assetPurchaseJournal(0, "Tunai", "1101")).toThrow("Nilai pembelian aset harus lebih dari nol");
    expect(() => assetPurchaseJournal(Number.NaN, "Tunai", "1101")).toThrow("Nilai pembelian aset harus lebih dari nol");
  });

  it("requires an active mapped cash or bank account", () => {
    expect(() => assetPurchaseJournal(1000, "Tunai", "")).toThrow("Rekening Kas/Bank wajib dipilih");
  });
});
