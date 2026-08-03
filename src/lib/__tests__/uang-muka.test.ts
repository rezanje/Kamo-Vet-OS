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
    const l = jurnalUangMuka("1102", 5_000_000);
    expect(l).toEqual([
      { code: "1303", debit: 5_000_000, credit: 0 },
      { code: "1102", debit: 0, credit: 5_000_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("nol atau negatif tidak menghasilkan jurnal", () => {
    expect(jurnalUangMuka("1102", 0)).toEqual([]);
    expect(jurnalUangMuka("1102", -1)).toEqual([]);
  });
});

describe("jurnalBayarHutang", () => {
  it("tanpa uang muka: hutang berkurang, kas keluar", () => {
    const l = jurnalBayarHutang("1102", 1_000_000, 0);
    expect(l).toEqual([
      { code: "2101", debit: 1_000_000, credit: 0 },
      { code: "1102", debit: 0, credit: 1_000_000 },
    ]);
  });

  it("sebagian dari uang muka: kas cuma keluar sisanya", () => {
    const l = jurnalBayarHutang("1102", 1_000_000, 400_000);
    expect(l).toEqual([
      { code: "2101", debit: 1_000_000, credit: 0 },
      { code: "1303", debit: 0, credit: 400_000 },
      { code: "1102", debit: 0, credit: 600_000 },
    ]);
    expect(seimbang(l)).toBe(true);
  });

  it("lunas penuh dari uang muka: kas tidak tersentuh sama sekali", () => {
    const l = jurnalBayarHutang("1102", 1_000_000, 1_000_000);
    expect(l.some((x) => x.code === "1102")).toBe(false);
    expect(seimbang(l)).toBe(true);
  });

  it("uang muka melebihi nominal bayar tetap dibatasi nominalnya", () => {
    const l = jurnalBayarHutang("1102", 300_000, 900_000);
    expect(l.find((x) => x.code === "1303")?.credit).toBe(300_000);
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
