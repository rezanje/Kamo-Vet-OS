import { describe, expect, it } from "vitest";
import { cashExpenseTotal, cashVariance, expectedCash, invoiceCashRows, methodBreakdown, PAYMENT_METHODS } from "../shift-calc";

describe("methodBreakdown", () => {
  it("accepts supported large amounts whose binary multiplication has harmless residue", () => {
    const result = methodBreakdown([{ total: 10000000000.03, metode_bayar: "Split", sale_payments: [
      { method: "Tunai", amount: 0.03 }, { method: "Transfer", amount: 10000000000 },
    ] }]);
    expect(result.Tunai).toBe(0.03);
    expect(result.Transfer).toBe(10000000000);
  });
  it("adds accepted cash allocations at cent precision", () => {
    expect(methodBreakdown([
      { total: 0.2, metode_bayar: "Split", sale_payments: [{ method: "Tunai", amount: 0.1 }, { method: "Transfer", amount: 0.1 }] },
      { total: 0.3, metode_bayar: "Split", sale_payments: [{ method: "Tunai", amount: 0.2 }, { method: "Transfer", amount: 0.1 }] },
    ]).Tunai).toBe(0.3);
  });

  it("counts split cash and transfer allocations without adding the sale total twice", () => {
    const b = methodBreakdown([{ total: 100000, metode_bayar: "Split", sale_payments: [
      { method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 80000 },
    ] }]);
    expect(b.Tunai).toBe(20000);
    expect(b.Transfer).toBe(80000);
    expect(Object.values(b).reduce((sum, amount) => sum + amount, 0)).toBe(100000);
    expect(b).not.toHaveProperty("Split");
  });

  it("includes transfer in the supported shift methods", () => {
    expect(PAYMENT_METHODS).toContain("Transfer");
  });

  it("rejects missing or incomplete split allocations instead of hiding cash in a Split bucket", () => {
    expect(() => methodBreakdown([{ total: 100000, metode_bayar: "Split" }])).toThrow(/pembayaran/i);
    expect(() => methodBreakdown([{ total: 100000, metode_bayar: "Split", sale_payments: [
      { method: "Tunai", amount: 20000 }, { method: "Transfer", amount: 70000 },
    ] }])).toThrow(/pembayaran/i);
  });

  it("does not use the legacy fallback for a planned finalized sale with missing canonical payment rows", () => {
    expect(() => methodBreakdown([{ total: 100000, metode_bayar: "Tunai", payment_plan: [{ method: "Tunai", amount: 100000 }],
      payments_finalized_at: "2026-10-15T05:00:01Z", sale_payments: [] }])).toThrow(/pembayaran/i);
  });

  it("accepts a finalized free sale with an empty payment plan without adding money", () => {
    expect(methodBreakdown([{ total: 0, metode_bayar: "Tunai", payment_plan: [], payments_finalized_at: "2026-10-15T05:00:01Z", sale_payments: [] }]))
      .toEqual(Object.fromEntries(PAYMENT_METHODS.map(method => [method, 0])));
  });

  it("compares fractional allocations in cents instead of rejecting a balanced payment", () => {
    const breakdown = methodBreakdown([{ total: 0.3, metode_bayar: "Split", sale_payments: [
      { method: "Tunai", amount: 0.1 }, { method: "Transfer", amount: 0.2 },
    ] }]);
    expect(breakdown.Tunai).toBe(0.1);
    expect(breakdown.Transfer).toBe(0.2);
  });

  it("rejects fractional amounts below one cent", () => {
    expect(() => methodBreakdown([{ total: 0.101, metode_bayar: "Tunai", sale_payments: [{ method: "Tunai", amount: 0.101 }] }])).toThrow(/pembayaran/i);
    expect(() => methodBreakdown([{ total: 0.3, metode_bayar: "Split", sale_payments: [
      { method: "Tunai", amount: 0.101 }, { method: "Transfer", amount: 0.199 },
    ] }])).toThrow(/pembayaran/i);
  });

  it("reads a Split header with one remaining valid allocation", () => {
    expect(methodBreakdown([{ total: 100000, metode_bayar: "Split", sale_payments: [{ method: "Transfer", amount: 100000 }] }]).Transfer).toBe(100000);
  });

  it("groups totals per payment method with all methods present", () => {
    const b = methodBreakdown([
      { total: 10000, metode_bayar: "Tunai" },
      { total: 5000, metode_bayar: "Tunai" },
      { total: 20000, metode_bayar: "QRIS" },
    ]);
    expect(b["Tunai"]).toBe(15000);
    expect(b["QRIS"]).toBe(20000);
    expect(b["Debit"]).toBe(0);
    for (const m of PAYMENT_METHODS) expect(b).toHaveProperty(m);
  });

  it("keeps unknown methods instead of dropping them", () => {
    const b = methodBreakdown([{ total: 7000, metode_bayar: "Transfer" }]);
    expect(b["Transfer"]).toBe(7000);
  });
});

describe("expectedCash", () => {
  it("keeps the expected drawer balance exact after fractional inflows and outflows", () => {
    expect(expectedCash(0.1, { Tunai: 0.2 }, 0.1)).toBe(0.2);
  });

  it("counts opening balance plus cash only", () => {
    expect(expectedCash(100000, { Tunai: 50000, QRIS: 999999 })).toBe(150000);
  });
  it("handles missing Tunai key", () => {
    expect(expectedCash(100000, {})).toBe(100000);
  });
  it("subtracts cash expenses taken from the drawer", () => {
    expect(expectedCash(100000, { Tunai: 50000 }, 20000)).toBe(130000);
  });
});

describe("cashExpenseTotal", () => {
  it("adds cash expenses at cent precision", () => {
    expect(cashExpenseTotal([{ jumlah: 0.1, metode_bayar: "Tunai" }, { jumlah: 0.2, metode_bayar: "Tunai" }])).toBe(0.3);
  });

  it("counts only Tunai expenses — transfer/QRIS leave the bank, not the drawer", () => {
    expect(cashExpenseTotal([
      { jumlah: 25000, metode_bayar: "Tunai" },
      { jumlah: 15000, metode_bayar: "Tunai" },
      { jumlah: 250000, metode_bayar: "Transfer" },
    ])).toBe(40000);
  });
  it("is zero when there are no expenses", () => {
    expect(cashExpenseTotal([])).toBe(0);
  });
});

describe("invoiceCashRows", () => {
  it("maps Lunas→total, DP→dp_amount, Belum Lunas→0", () => {
    const rows = invoiceCashRows([
      { total: 100000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai" },
      { total: 200000, dp_amount: 50000, paid_status: "DP", metode_bayar: "Tunai" },
      { total: 300000, dp_amount: 0, paid_status: "Belum Lunas", metode_bayar: "QRIS" },
    ]);
    expect(rows.map((r) => r.total)).toEqual([100000, 50000, 0]);
    expect(rows[2].metode_bayar).toBe("QRIS");
  });

  // Kebocoran nyata: invoice DP yang belakangan dilunasi lewat layar Piutang
  // (uangnya masuk bank, bukan laci) berubah jadi "Lunas". Kalau shift aslinya
  // masih terbuka, target kas kasir ikut melonjak sebesar SELURUH tagihan.
  it("pelunasan susulan tidak menaikkan kas shift yang menerbitkan", () => {
    const rows = invoiceCashRows([
      { total: 500000, dp_amount: 100000, paid_status: "Lunas", metode_bayar: "Tunai", dibayarSusulan: 400000 },
    ]);
    expect(rows[0].total).toBe(100000); // hanya DP-nya, bukan 500.000
  });

  it("Lunas tanpa pelunasan susulan = dibayar penuh di meja", () => {
    const rows = invoiceCashRows([
      { total: 500000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai", dibayarSusulan: 0 },
    ]);
    expect(rows[0].total).toBe(500000);
  });

  it("baris lama tanpa info pelunasan tetap terbaca seperti sebelumnya", () => {
    const rows = invoiceCashRows([
      { total: 500000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai" },
    ]);
    expect(rows[0].total).toBe(500000);
  });

  it("terbit ulang menghitung hanya uang kas shift awal, bukan kredit dan cicilan", () => {
    const rows = invoiceCashRows([
      { total: 500000, dp_amount: 0, paid_status: "Lunas", metode_bayar: "Tunai",
        dibayarSusulan: 500000, shift_cash_carry: 100000 },
    ]);
    expect(rows[0].total).toBe(100000);
  });
});

describe("cashVariance", () => {
  it("returns the exact cent difference for fractional drawer balances", () => {
    expect(cashVariance(0.3, 0.1)).toBe(0.2);
  });

  it("negative when short, positive when over, zero when exact", () => {
    expect(cashVariance(90000, 100000)).toBe(-10000);
    expect(cashVariance(110000, 100000)).toBe(10000);
    expect(cashVariance(100000, 100000)).toBe(0);
  });
});
