import { describe, expect, it } from "vitest";
import { branchDisplayName } from "./branch-display";

const catalog = [
  { code: "CIAW", name: "Kamo Petshop Ciawi", type: "PETSHOP" },
  { code: "GRND", name: "Kamo Petshop Granada", type: "PETSHOP" },
];

describe("branchDisplayName", () => {
  it("uses the exact paired POS master name for a vet branch", () => {
    expect(branchDisplayName({ code: "VET_CIAW", name: "Older clinic label", type: "KLINIK" }, catalog))
      .toBe("Kamo Petshop Ciawi · Vet");
  });

  it("keeps an unmatched clinic's own master name and identity", () => {
    const branch = { id: "clinic", code: "VET_GRDA", name: "HPY Garuda", type: "KLINIK" };
    expect(branchDisplayName(branch, catalog)).toBe("HPY Garuda · Vet");
    expect(branch.name).toBe("HPY Garuda");
  });

  it("does not infer a similar but different POS code or relabel petshop", () => {
    expect(branchDisplayName({ code: "VET_GRDA", name: "HPY Garuda", type: "KLINIK" }, catalog))
      .not.toContain("Granada");
    expect(branchDisplayName(catalog[0], catalog)).toBe("Kamo Petshop Ciawi");
  });

  it("does not append the marker twice", () => {
    expect(branchDisplayName({ code: "VET_GLG", name: "Gerlong · Vet", type: "KLINIK" }, []))
      .toBe("Gerlong · Vet");
    expect(branchDisplayName({ code: "MIXED", name: "Mixed outlet", type: "BOTH" }, catalog))
      .toBe("Mixed outlet · Vet");
  });
});
