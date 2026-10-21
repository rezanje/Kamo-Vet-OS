export type MonetaryOpeningLine = { code: string; debit: number; credit: number };
export type MonetaryOpeningPreview = {
  account_id: string; account_code: string; account_name: string;
  original_entry_id: string | null; original_no_jurnal: string | null;
  tanggal: string; branch_id: string | null; revision: number;
  old_amount: number; new_amount: number; delta: number; reason: string;
  balance_before: number; balance_after: number;
  base_fingerprint: string; ledger_fingerprint: string;
  reversal: MonetaryOpeningLine[]; replacement: MonetaryOpeningLine[];
};
