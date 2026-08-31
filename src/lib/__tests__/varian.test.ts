import { describe, expect, it } from "vitest";
import { validateVariantMembers } from "../varian";

describe("validateVariantMembers", () => {
  it("menolak SKU kembar dan Grup sebagai anggota", () => {
    expect(validateVariantMembers([
      { itemId: "i1", itemType: "Persediaan", label: "400 gr" },
      { itemId: "i1", itemType: "Persediaan", label: "800 gr" },
    ])).toMatch(/SKU hanya boleh sekali/);
    expect(validateVariantMembers([{ itemId: "g1", itemType: "Grup", label: "Paket" }]))
      .toMatch(/Grup/);
  });

  it("memerlukan dua SKU dan label yang terisi", () => {
    expect(validateVariantMembers([{ itemId: "i1", itemType: "Persediaan", label: "400 gr" }]))
      .toMatch(/minimal dua/);
    expect(validateVariantMembers([
      { itemId: "i1", itemType: "Persediaan", label: "400 gr" },
      { itemId: "i2", itemType: "Persediaan", label: " " },
    ])).toMatch(/Label/);
  });
});
