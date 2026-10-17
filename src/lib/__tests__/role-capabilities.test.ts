import { describe, expect, it } from "vitest";
import { roleCapabilities } from "../role-capabilities";

describe("role capabilities", () => {
  it("keeps the super admin's permissions", () => {
    expect(roleCapabilities("OWNER", { all_branches: false, create_accounts: false })).toEqual({ all_branches: true, create_accounts: true });
  });
  it("lets super admin grant leaders cross-branch access and account creation", () => {
    expect(roleCapabilities("STAFF", { all_branches: true, create_accounts: true })).toEqual({ all_branches: true, create_accounts: true });
  });
  it("allows explicit revocation of admin defaults", () => {
    expect(roleCapabilities("ADMIN", { all_branches: false, create_accounts: false })).toEqual({ all_branches: false, create_accounts: false });
  });
  it("preserves existing defaults until configured", () => {
    expect(roleCapabilities("STAFF", null)).toEqual({ all_branches: false, create_accounts: false });
    expect(roleCapabilities("ADMIN", null)).toEqual({ all_branches: true, create_accounts: true });
    expect(roleCapabilities("FINANCE", null)).toEqual({ all_branches: true, create_accounts: false });
  });
});
