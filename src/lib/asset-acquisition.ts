export type AssetFunding = "Tunai" | "Bank";
export type AssetJournalLine = { code: string; debit: number; credit: number };

export function assertNewAssetFunding(value: string): asserts value is AssetFunding {
  if (value !== "Tunai" && value !== "Bank") {
    throw new Error("Pembelian baru wajib memakai Kas atau Bank");
  }
}

export function assetPurchaseJournal(
  amount: number,
  funding: string,
  creditCode: string | null | undefined,
): AssetJournalLine[] {
  assertNewAssetFunding(funding);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Nilai pembelian aset harus lebih dari nol");
  }
  const code = String(creditCode ?? "").trim();
  if (!code) throw new Error("Rekening Kas/Bank wajib dipilih");
  return [
    { code: "1501", debit: amount, credit: 0 },
    { code, debit: 0, credit: amount },
  ];
}
