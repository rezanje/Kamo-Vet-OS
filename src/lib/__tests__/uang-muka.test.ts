import { describe, expect, it } from "vitest";
import { formatNoUangMuka, jurnalBayarHutang, jurnalUangMuka, pakaiUangMuka } from "../uang-muka";

const seimbang = (l: { debit: number; credit: number }[]) =>
  l.reduce((a, x) => a + x.debit, 0) === l.reduce((a, x) => a + x.credit, 0);

describe("formatNoUangMuka", () => {
  it("format UM.YYYY.MM.NNNNN", () => {
    expect(formatNoUangMuka(new Date(2026, 7, 3), 7)).toBe("UM.2026.08.00007");
  });
});

describe("jurnalUangMuka", () => {
  it("uang keluar jadi hak tagih, bukan beban", () => {
    const l = jurnalUangMuka("120002", 5_000_000);
    expect(l).toEqual([
      { code: "160001", debit: 5_000_000, credit: 0 },
      { code: "120002", debit: 0, credit: 5_000_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("nol atau negatif tidak menghasilkan jurnal", () => {
    expect(jurnalUangMuka("120002", 0)).toEqual([]);
    expect(jurnalUangMuka("120002", -1)).toEqual([]);
  });
});

describe("jurnalBayarHutang", () => {
  it("tanpa uang muka: hutang berkurang, kas keluar", () => {
    const l = jurnalBayarHutang("120002", 1_000_000, 0);
    expect(l).toEqual([
      { code: "311001", debit: 1_000_000, credit: 0 },
      { code: "120002", debit: 0, credit: 1_000_000 },
    ]);
  });

  it("sebagian dari uang muka: kas cuma keluar sisanya", () => {
    const l = jurnalBayarHutang("120002", 1_000_000, 400_000);
    expect(l).toEqual([
      { code: "311001", debit: 1_000_000, credit: 0 },
      { code: "160001", debit: 0, credit: 400_000 },
      { code: "120002", debit: 0, credit: 600_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("lunas penuh dari uang muka: kas tidak tersentuh sama sekali", () => {
    const l = jurnalBayarHutang("120002", 1_000_000, 1_000_000);
    expect(l.some((x) => x.code === "120002")).toBe(false);
    expect(seimbang(l)).toBe(true);
  });

  it("uang muka melebihi nominal bayar tetap dibatasi nominalnya", () => {
    const l = jurnalBayarHutang("120002", 300_000, 900_000);
    expect(l.find((x) => x.code === "160001")?.credit).toBe(300_000);
    expect(seimbang(l)).toBe(true);
  });
});

describe("pakaiUangMuka", () => {
  it("ambil yang terkecil antara sisa uang muka dan nominal bayar", () => {
    expect(pakaiUangMuka(500_000, 300_000)).toBe(300_000);
    expect(pakaiUangMuka(200_000, 300_000)).toBe(200_000);
    expect(pakaiUangMuka(0, 300_000)).toBe(0);
    expect(pakaiUangMuka(-5, 300_000)).toBe(0);
  });
});
