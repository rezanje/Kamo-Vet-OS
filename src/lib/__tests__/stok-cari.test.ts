import { describe, expect, it } from "vitest";
import { cocokCariStok, polaCariStok } from "../stok-cari";

describe("polaCariStok", () => {
  it("kosong → null", () => {
    expect(polaCariStok("")).toBeNull();
    expect(polaCariStok("   ")).toBeNull();
    expect(polaCariStok(undefined)).toBeNull();
  });
  it("spasi jadi wildcard", () => {
    expect(polaCariStok("bolt 1kg")).toBe("*bolt*1kg*");
  });
  it("membuang karakter sintaks filter", () => {
    expect(polaCariStok("a,b(c)%_*:\"'\\")).toBe("*a*b*c*");
  });
});

describe("cocokCariStok", () => {
  it("cocok nama berurutan, tidak peka huruf besar", () => {
    expect(cocokCariStok("bolt 1kg", "B001", "BOLT IKAN 1KG")).toBe(true);
    expect(cocokCariStok("1kg bolt", "B001", "BOLT IKAN 1KG")).toBe(false);
  });
  it("cocok kode", () => {
    expect(cocokCariStok("b001", "B001", "BOLT IKAN 1KG")).toBe(true);
  });
  it("tidak cocok", () => {
    expect(cocokCariStok("whiskas", "B001", "BOLT IKAN 1KG")).toBe(false);
  });
});
