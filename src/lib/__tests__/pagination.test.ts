import { describe, expect, it } from "vitest";
import { infoHalaman } from "../pagination";

describe("infoHalaman", () => {
  it("membuat rentang data tanpa memotong daftar di angka 500", () => {
    expect(infoHalaman("6", 1_245, 100)).toEqual({
      page: 6,
      from: 500,
      to: 599,
      totalPages: 13,
    });
  });

  it("menahan nomor halaman yang tidak valid ke rentang aman", () => {
    expect(infoHalaman("99", 15, 100)).toMatchObject({ page: 1, from: 0, to: 99, totalPages: 1 });
    expect(infoHalaman("rusak", 250, 100)).toMatchObject({ page: 1, from: 0, to: 99, totalPages: 3 });
  });
});
