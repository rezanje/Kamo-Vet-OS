export type AssetFunding = "cash" | "bank" | "accounts_payable";
export type AssetJournalLine = { code: string; debit: number; credit: number };

export function assetPurchaseJournal(
  amount: number,
  funding: AssetFunding,
  paymentAccountCode?: string | null,
): AssetJournalLine[] {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Nilai pembelian aset harus lebih dari nol");
  const creditCode = funding === "accounts_payable" ? "2101" : String(paymentAccountCode ?? "").trim();
  if (!creditCode) throw new Error("Rekening Kas/Bank wajib dipilih");
  return [
    { code: "1501", debit: amount, credit: 0 },
    { code: creditCode, debit: 0, credit: amount },
  ];
}

export function assertNewAssetFunding(value: string): asserts value is AssetFunding {
  if (!(["cash", "bank", "accounts_payable"] as string[]).includes(value)) {
    throw new Error("Pembelian baru wajib memakai Kas, Bank, atau Hutang Usaha");
  }
}
