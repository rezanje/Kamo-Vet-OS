export type BranchCashAccount = {
  coa_code: string;
  branch_id: string | null;
  jenis: string;
  is_active: boolean;
};

export function isBranchCashAccount(account: BranchCashAccount | null, branchId: string): boolean {
  return !!account && account.is_active === true && account.jenis === "Kas"
    && account.branch_id === branchId && /^110[0-9]{3}$/.test(account.coa_code);
}
