import { describe, expect, it } from "vitest";
import { branchTypeMatches, operationalMode, parseBranchContext } from "../operational-context";
const branchId = "ab000000-0000-4000-8000-000000000001";
describe("operational context", () => {
  it("gates both operational worlds and all descendants, preserving backoffice", () => {
    for (const path of ["/klinik", "/klinik/antrian/123", "/klinik/shift"]) expect(operationalMode(path)).toBe("klinik");
    for (const path of ["/kasir", "/kasir/mulai", "/kasir/struk/123"]) expect(operationalMode(path)).toBe("petshop");
    for (const path of ["/", "/me", "/mulai/cabang", "/klinik-lain", "/booking"]) expect(operationalMode(path)).toBeNull();
  });
  it("rejects absent, malformed, cross-account and invalid branch cookies", () => {
    for (const value of [undefined, "bad", "null", JSON.stringify({userId:"other",branchId}), JSON.stringify({userId:"me",branchId:"bad"})]) expect(parseBranchContext(value,"me")).toBeNull();
    expect(parseBranchContext(JSON.stringify({userId:"me",branchId}),"me")).toEqual({userId:"me",branchId});
  });
  it("keeps clinic and petshop contexts independent", () => {
    expect(branchTypeMatches("BOTH","klinik")).toBe(true);
    expect(branchTypeMatches("PETSHOP","klinik")).toBe(false);
    expect(branchTypeMatches("KLINIK","petshop")).toBe(false);
    expect(branchTypeMatches("unknown","petshop")).toBe(false);
  });
});
