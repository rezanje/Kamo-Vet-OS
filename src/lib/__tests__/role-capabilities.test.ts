import { describe, expect, it } from "vitest";
import { roleCapabilities } from "../role-capabilities";

// Kemampuan "diskon manual" (keputusan pemilik 29 Okt 2026) ikut matriks yang sama;
// aturan bawaannya diuji terpisah di akses-diskon.test.ts.

describe("role capabilities", () => {
  it("keeps the super admin's permissions", () => {
    expect(roleCapabilities("OWNER", { all_branches: false, create_accounts: false, manual_discount: false })).toEqual({ all_branches: true, create_accounts: true, manual_discount: true });
  });
  it("lets super admin grant leaders cross-branch access and account creation", () => {
    expect(roleCapabilities("STAFF", { all_branches: true, create_accounts: true, manual_discount: true })).toEqual({ all_branches: true, create_accounts: true, manual_discount: true });
  });
  it("allows explicit revocation of admin defaults", () => {
    expect(roleCapabilities("ADMIN", { all_branches: false, create_accounts: false, manual_discount: false })).toEqual({ all_branches: false, create_accounts: false, manual_discount: false });
  });
  it("preserves existing defaults until configured", () => {
    expect(roleCapabilities("STAFF", null)).toEqual({ all_branches: false, create_accounts: false, manual_discount: false });
    expect(roleCapabilities("ADMIN", null)).toEqual({ all_branches: true, create_accounts: true, manual_discount: true });
    expect(roleCapabilities("FINANCE", null)).toEqual({ all_branches: true, create_accounts: false, manual_discount: true });
  });
});
