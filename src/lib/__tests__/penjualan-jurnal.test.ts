import { describe, expect, it } from "vitest";
import { jurnalPenjualanInklusif, jurnalPenjualanKlinik } from "../penjualan-jurnal";

const total = (lines: { debit: number; credit: number }[], side: "debit" | "credit") =>
  lines.reduce((sum, line) => sum + line[side], 0);

describe("jurnalPenjualanInklusif", () => {
  it("memisahkan pendapatan bruto, diskon, dan PPN tanpa mengubah uang masuk", () => {
    const lines = jurnalPenjualanInklusif({
      kasCode: "110003",
      subtotal: 111_000,
      total: 99_900,
      splitPajak: (nilai) => ({ dpp: Math.round(nilai / 1.11), ppn: nilai - Math.round(nilai / 1.11) }),
    });

    expect(lines).toContainEqual({ code: "110003", debit: 99_900, credit: 0 });
    expect(lines).toContainEqual({ code: "510001", debit: 0, credit: 100_000 });
    expect(lines).toContainEqual({ code: "520002", debit: 10_000, credit: 0 });
    expect(lines).toContainEqual({ code: "312005", debit: 0, credit: 9_900 });
    expect(total(lines, "debit")).toBe(total(lines, "credit"));
  });

  it("tanpa diskon tetap memakai jurnal ringkas", () => {
    expect(jurnalPenjualanInklusif({
      kasCode: "110003",
      subtotal: 111_000,
      total: 111_000,
      splitPajak: (nilai) => ({ dpp: 100_000, ppn: nilai - 100_000 }),
    })).toEqual([
      { code: "110003", debit: 111_000, credit: 0 },
      { code: "510001", debit: 0, credit: 100_000 },
      { code: "312005", debit: 0, credit: 11_000 },
    ]);
  });
});

describe("jurnalPenjualanKlinik", () => {
  it("menampilkan diskon sebagai pengurang pendapatan jasa", () => {
    const lines = jurnalPenjualanKlinik({
      kasCode: "110003", subtotal: 200_000, discount: 20_000,
      total: 199_800, tax: 19_800, cashReceived: 99_900,
    });
    expect(lines).toContainEqual({ code: "520002", debit: 20_000, credit: 0 });
    expect(lines).toContainEqual({ code: "510002", debit: 0, credit: 200_000 });
    expect(lines).toContainEqual({ code: "150001", debit: 99_900, credit: 0 });
    expect(total(lines, "debit")).toBe(total(lines, "credit"));
  });
});
