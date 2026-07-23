import { describe, expect, it } from "vitest";
import { buildClosingLines } from "../tutup-buku";

describe("buildClosingLines", () => {
  it("tutup pendapatan (Dr) & beban (Cr), laba ke 3201 (Cr)", () => {
    const { lines, laba } = buildClosingLines([
      { code: "4101", type: "PENDAPATAN", saldo: 1000 },
      { code: "5101", type: "BEBAN", saldo: 400 },
      { code: "1101", type: "ASET", saldo: 999 }, // diabaikan
    ]);
    expect(laba).toBe(600);
    expect(lines).toContainEqual({ code: "4101", debit: 1000, credit: 0 });
    expect(lines).toContainEqual({ code: "5101", debit: 0, credit: 400 });
    expect(lines).toContainEqual({ code: "3201", debit: 0, credit: 600 });
    // jurnal seimbang
    const d = lines.reduce((a, l) => a + l.debit, 0);
    const k = lines.reduce((a, l) => a + l.credit, 0);
    expect(d).toBe(k);
  });

  it("rugi -> 3201 di Debit; saldo negatif dibalik arah", () => {
    const { lines, laba } = buildClosingLines([
      { code: "4101", type: "PENDAPATAN", saldo: 100 },
      { code: "5901", type: "BEBAN", saldo: -50 },  // beban negatif (koreksi) → Debit
      { code: "5101", type: "BEBAN", saldo: 400 },
    ]);
    expect(laba).toBe(-250);
    expect(lines).toContainEqual({ code: "5901", debit: 50, credit: 0 });
    expect(lines).toContainEqual({ code: "3201", debit: 250, credit: 0 });
  });

  it("semua nol -> tidak ada baris", () => {
    expect(buildClosingLines([{ code: "4101", type: "PENDAPATAN", saldo: 0 }]).lines).toHaveLength(0);
  });
});
