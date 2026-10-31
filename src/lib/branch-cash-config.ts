export type BranchCashAccount = {
  coa_code: string;
  branch_id: string | null;
  jenis: string;
  is_active: boolean;
};

// Candidate assignments awaiting Owner approval before any Production mapping.
// Keep this list in sync with branch_cash_matches in the draft SQL migration.
export const BRANCH_CASH_CODES: Readonly<Record<string, string>> = {
  "110004": "BTKM", "110005": "CIAW", "110006": "CMS", "110007": "CMGG",
  "110008": "MUAR", "110009": "TKI", "110010": "GRND", "110011": "SRKN",
  "110012": "PDRY", "110013": "VET_CMS", "110014": "VET_CMGG",
  "110015": "VET_CIAW", "110016": "VET_PDRY", "110017": "VET_TKI",
  "110018": "VET_GRDA", "110019": "VET_GRLG", "110020": "VET_SRKN",
  "110021": "VET_GRND",
};

export function isApprovedBranchCashPair(coaCode: string, branchCode: string): boolean {
  return BRANCH_CASH_CODES[coaCode] === branchCode;
}

export function isBranchCashAccount(account: BranchCashAccount | null, branchId: string, branchCode: string): boolean {
  return !!account && account.is_active === true && account.jenis === "Kas"
    && account.branch_id === branchId && isApprovedBranchCashPair(account.coa_code, branchCode);
}
