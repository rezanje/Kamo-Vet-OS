import { describe, it, expect } from "vitest";
import { jurnalSaldoAwal, nilaiPersediaan, selisihSaldoAwal } from "../saldo-awal";

const totalD = (l: { debit: number }[]) => l.reduce((a, x) => a + x.debit, 0);
const totalK = (l: { credit: number }[]) => l.reduce((a, x) => a + x.credit, 0);

describe("jurnalSaldoAwal", () => {
  it("selisih harta dikurangi utang jadi Modal Pemilik, dan jurnalnya selalu seimbang", () => {
    const { lines, modal } = jurnalSaldoAwal([
      { code: "1301", nilai: 5_000_000, sisi: "D" },  // persediaan
      { code: "1501", nilai: 12_000_000, sisi: "D" }, // aset tetap
      { code: "2101", nilai: 3_000_000, sisi: "K" },  // hutang usaha
    ]);
    expect(modal).toBe(14_000_000);
    expect(lines).toContainEqual({ code: "3101", debit: 0, credit: 14_000_000 });
    expect(totalD(lines)).toBe(totalK(lines));
  });

  it("utang lebih besar dari harta -> modal jadi sisi debit (defisit), tetap seimbang", () => {
    const { lines, modal } = jurnalSaldoAwal([
      { code: "1301", nilai: 1_000_000, sisi: "D" },
      { code: "2101", nilai: 4_000_000, sisi: "K" },
    ]);
    expect(modal).toBe(-3_000_000);
    expect(lines).toContainEqual({ code: "3101", debit: 3_000_000, credit: 0 });
    expect(totalD(lines)).toBe(totalK(lines));
  });

  // Akumulasi penyusutan aset lama: harta bersaldo kredit.
  it("akumulasi penyusutan masuk sisi kredit dan mengurangi modal", () => {
    const { lines, modal } = jurnalSaldoAwal([
      { code: "1501", nilai: 12_000_000, sisi: "D" },
      { code: "1509", nilai: 800_000, sisi: "K" },
    ]);
    expect(modal).toBe(11_200_000);
    expect(lines).toContainEqual({ code: "1509", debit: 0, credit: 800_000 });
    expect(totalD(lines)).toBe(totalK(lines));
  });

  it("nilai nol dilewati; tidak ada baris -> tidak ada jurnal sama sekali", () => {
    expect(jurnalSaldoAwal([{ code: "1301", nilai: 0, sisi: "D" }]).lines).toEqual([]);
    expect(jurnalSaldoAwal([]).lines).toEqual([]);
  });

  it("nilai negatif membalik sisinya, bukan bikin jurnal bernilai minus", () => {
    const { lines } = jurnalSaldoAwal([{ code: "1301", nilai: -250_000, sisi: "D" }]);
    expect(lines[0]).toEqual({ code: "1301", debit: 0, credit: 250_000 });
    expect(totalD(lines)).toBe(totalK(lines));
  });
});

describe("selisihSaldoAwal", () => {
  it("yang perlu diposting = kondisi nyata dikurangi yang sudah tercatat", () => {
    expect(selisihSaldoAwal(5_000_000, 0)).toBe(5_000_000);
    expect(selisihSaldoAwal(5_000_000, 5_000_000)).toBe(0);
  });

  // Kasus nyata VetOS: HPP sudah mengkredit Persediaan padahal stok awal tak pernah didebit.
  it("saldo buku minus -> selisihnya lebih besar dari nilai fisik", () => {
    expect(selisihSaldoAwal(2_000_000, -610_000)).toBe(2_610_000);
  });
});

describe("nilaiPersediaan", () => {
  it("dijumlah dari sisa lapisan FIFO kali modalnya", () => {
    expect(nilaiPersediaan([
      { qty_left: 10, unit_cost: 15_000 },
      { qty_left: 3, unit_cost: 20_000 },
    ])).toBe(210_000);
    expect(nilaiPersediaan([])).toBe(0);
  });
});
