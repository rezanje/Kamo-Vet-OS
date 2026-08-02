import { describe, expect, it } from "vitest";
import { kodeBawaan, pilihKodeAkun, type PetaBaris } from "../kas-akun";

const CABANG = "cab-1";
const peta: PetaBaris[] = [
  { metode: "QRIS", branch_id: null, coa_code: "1103" },
  { metode: "QRIS", branch_id: CABANG, coa_code: "1104" },
  { metode: "Debit", branch_id: null, coa_code: "1105" },
];

describe("pilihKodeAkun", () => {
  it("aturan cabang menang atas aturan pusat", () => {
    expect(pilihKodeAkun(peta, "QRIS", CABANG)).toBe("1104");
  });

  it("cabang tanpa aturan sendiri ikut pusat", () => {
    expect(pilihKodeAkun(peta, "QRIS", "cab-lain")).toBe("1103");
    expect(pilihKodeAkun(peta, "Debit", CABANG)).toBe("1105");
  });

  it("metode tanpa aturan jatuh ke bawaan lama", () => {
    expect(pilihKodeAkun(peta, "E-Wallet", CABANG)).toBe("1102");
    expect(pilihKodeAkun(peta, "Tunai", CABANG)).toBe("1101");
  });

  it("peta kosong = perilaku sebelum fitur ini ada", () => {
    expect(pilihKodeAkun([], "Tunai", null)).toBe("1101");
    expect(pilihKodeAkun([], "QRIS", null)).toBe("1102");
  });

  it("hanya Tunai yang jatuh ke kas", () => {
    expect(kodeBawaan("Tunai")).toBe("1101");
    expect(kodeBawaan("Transfer")).toBe("1102");
  });
});
