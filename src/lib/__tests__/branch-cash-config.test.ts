import { describe, expect, it } from "vitest";
import { isBranchCashAccount } from "../branch-cash-config";

const account = { coa_code: "110013", branch_id: "vet-cms", jenis: "Kas", is_active: true };

describe("isBranchCashAccount", () => {
  it("accepts only an active cash account belonging to the selected branch", () => {
    expect(isBranchCashAccount(account, "vet-cms")).toBe(true);
    expect(isBranchCashAccount({ ...account, branch_id: "petshop-cms" }, "vet-cms")).toBe(false);
    expect(isBranchCashAccount({ ...account, jenis: "Bank" }, "vet-cms")).toBe(false);
    expect(isBranchCashAccount({ ...account, is_active: false }, "vet-cms")).toBe(false);
  });

  it("rejects an unassigned or non-COA cash account", () => {
    expect(isBranchCashAccount({ ...account, branch_id: null }, "vet-cms")).toBe(false);
    expect(isBranchCashAccount({ ...account, coa_code: "120002" }, "vet-cms")).toBe(false);
  });
});
