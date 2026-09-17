import { describe, expect, it } from "vitest";
import { nomorHalamanKasirTerlihat } from "../kasir-halaman";

describe("nomorHalamanKasirTerlihat", () => {
  it("meringkas halaman panjang di sekitar halaman aktif", () => {
    expect(nomorHalamanKasirTerlihat(90, 85)).toEqual([1, "…", 83, 84, 85, 86, 87, "…", 90]);
  });

  it("menampilkan seluruh halaman bila jumlahnya kecil", () => {
    expect(nomorHalamanKasirTerlihat(5, 3)).toEqual([1, 2, 3, 4, 5]);
  });
});
