import { describe, expect, it } from "vitest";
import { hrefDokumen, tampakNomorDokumen } from "../tautan-dokumen";

describe("tampakNomorDokumen", () => {
  it("mengenali nomor dokumen VetOS", () => {
    for (const no of [
      "FJ.2026.08.00001", "FJS.2026.08.00001", "OPO.00385", "OPR.00362",
      "JRN-202608-0091", "POS-20260814-0003", "RJ.2026.08.00002", "TB.2026.07.00010",
    ]) {
      expect(tampakNomorDokumen(no), no).toBe(true);
    }
  });

  it("keterangan bebas tidak ikut jadi tautan", () => {
    for (const teks of ["bayar listrik", "—", "", "Beban Listrik & Air", "2026-08-17", "12345"]) {
      expect(tampakNomorDokumen(teks), teks).toBe(false);
    }
  });
});

describe("hrefDokumen", () => {
  it("nomor dengan garis miring tetap aman di URL", () => {
    expect(hrefDokumen("FJ/2026/01")).toBe("/dokumen/FJ%2F2026%2F01");
  });
});
