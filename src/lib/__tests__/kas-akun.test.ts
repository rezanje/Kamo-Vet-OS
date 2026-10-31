import { describe, expect, it } from "vitest";
import { kodeAkunBayar, kodeBawaan, pilihKodeAkun, type PetaBaris } from "../kas-akun";

const CABANG = "cab-1";
const peta: PetaBaris[] = [
  { metode: "QRIS", branch_id: null, coa_code: "1103" },
  { metode: "QRIS", branch_id: CABANG, coa_code: "1104" },
  { metode: "Debit", branch_id: null, coa_code: "182004" },
];

describe("pilihKodeAkun", () => {
  it("aturan cabang menang atas aturan pusat", () => {
    expect(pilihKodeAkun(peta, "QRIS", CABANG)).toBe("1104");
  });

  it("cabang tanpa aturan sendiri ikut pusat", () => {
    expect(pilihKodeAkun(peta, "QRIS", "cab-lain")).toBe("1103");
    expect(pilihKodeAkun(peta, "Debit", CABANG)).toBe("182004");
  });

  it("metode tanpa aturan jatuh ke bawaan lama", () => {
    expect(pilihKodeAkun(peta, "E-Wallet", CABANG)).toBe("120002");
    expect(() => pilihKodeAkun(peta, "Tunai", CABANG)).toThrow("Kas Tunai cabang");
  });

  it("peta kosong = perilaku sebelum fitur ini ada", () => {
    expect(pilihKodeAkun([], "Tunai", null)).toBe("110003");
    expect(pilihKodeAkun([], "QRIS", null)).toBe("120002");
  });

  it("Tunai cabang wajib masuk rekening kas aktif milik cabang itu", () => {
    const cabang: PetaBaris[] = [
      { metode: "Tunai", branch_id: CABANG, coa_code: "110006", account_branch_id: CABANG, account_kind: "Kas", account_active: true },
      { metode: "Tunai", branch_id: null, coa_code: "110003" },
    ];
    expect(pilihKodeAkun(cabang, "Tunai", CABANG)).toBe("110006");
    expect(() => pilihKodeAkun(cabang, "Tunai", "cabang-lain")).toThrow("Kas Tunai cabang");
    expect(() => pilihKodeAkun([{ ...cabang[0], account_branch_id: "cabang-lain" }], "Tunai", CABANG)).toThrow("Kas Tunai cabang");
    expect(() => pilihKodeAkun([{ ...cabang[0], account_active: false }], "Tunai", CABANG)).toThrow("Kas Tunai cabang");
  });

  it("hanya Tunai yang jatuh ke kas", () => {
    expect(kodeBawaan("Tunai")).toBe("110003");
    expect(kodeBawaan("Transfer")).toBe("120002");
  });
});

it("ignores a manually submitted cash account when a branch pays Tunai", async () => {
  const db = {
    from(table: string) {
      if (table !== "payment_account_map") throw new Error("Manual account lookup must not run");
      return { select: async () => ({ data: [{ metode: "Tunai", branch_id: CABANG,
        cash_accounts: { coa_code: "110006", branch_id: CABANG, jenis: "Kas", is_active: true } }] }) };
    },
  };
  expect(await kodeAkunBayar(db, "Tunai", CABANG, "some-other-account")).toBe("110006");
});
