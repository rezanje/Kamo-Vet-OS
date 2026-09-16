import { describe, expect, it } from "vitest";
import { infoHalaman } from "../pagination";

describe("infoHalaman", () => {
  it("menghitung rentang halaman yang benar", () => {
    expect(infoHalaman("3", 250, 100)).toMatchObject({ page: 3, from: 200, to: 299, totalPages: 3 });
  });

  it("kembali ke halaman pertama bila nomor halaman tidak valid", () => {
    expect(infoHalaman("99", 250, 100).page).toBe(1);
    expect(infoHalaman("bukan-angka", 250, 100).page).toBe(1);
  });
});
