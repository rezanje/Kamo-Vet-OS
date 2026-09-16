import { describe, expect, it } from "vitest";
import { canUseBranch, isCompanyWideRole } from "../branch-access";

describe("canUseBranch", () => {
  it("peran global (allowed null) boleh cabang mana pun", () => {
    expect(canUseBranch(null, "granada")).toBe(true);
  });

  it("staf hanya boleh cabang penempatannya", () => {
    expect(canUseBranch(["btkm"], "btkm")).toBe(true);
    expect(canUseBranch(["btkm"], "granada")).toBe(false);
  });

  it("tanpa penempatan tidak boleh cabang apa pun", () => {
    expect(canUseBranch([], "btkm")).toBe(false);
  });

  it("ADMIN wajib mengikuti penempatan cabang", () => {
    expect(isCompanyWideRole("ADMIN")).toBe(false);
  });

  it("OWNER dan FINANCE tetap lintas cabang", () => {
    expect(isCompanyWideRole("OWNER")).toBe(true);
    expect(isCompanyWideRole("FINANCE")).toBe(true);
  });
});
