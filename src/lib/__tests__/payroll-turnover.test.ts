import { describe, expect, it } from "vitest";
import { hitungKomponenOmzet } from "../payroll-turnover";
import type { BarisJual } from "../komisi";

const row = (omzet: number, overrides: Partial<BarisJual> = {}): BarisJual => ({
  tanggal: "2026-10-01", sumber: "klinik", employeeId: "doctor-a", branchId: "clinic-a",
  itemId: "procedure-a", kategoriIds: [], qty: 1, omzet, laba: null, ...overrides,
});

describe("posted turnover payroll components", () => {
  const rows = [
    row(90_000), // posted net amount after discount
    row(-10_000), // return
    row(20_000, { employeeId: "doctor-b" }),
    row(30_000, { employeeId: null, branchId: "clinic-b" }),
    row(40_000, { sumber: "kasir", employeeId: "seller-a" }),
  ];

  it("separates employee, own-branch, and all-clinic turnover from commission totals", () => {
    expect(hitungKomponenOmzet(rows, { source: "klinik", scope: "employee", ratePercent: 10 }, "doctor-a", "clinic-a"))
      .toEqual({ basis: 80_000, amount: 8_000 });
    expect(hitungKomponenOmzet(rows, { source: "klinik", scope: "own_branch", ratePercent: 10 }, "doctor-a", "clinic-a"))
      .toEqual({ basis: 100_000, amount: 10_000 });
    expect(hitungKomponenOmzet(rows, { source: "klinik", scope: "all_branches", ratePercent: 10 }, "manager", "clinic-a"))
      .toEqual({ basis: 130_000, amount: 13_000 });
  });

  it("fails closed for missing branch or invalid rate", () => {
    expect(() => hitungKomponenOmzet(rows, { source: "klinik", scope: "own_branch", ratePercent: 2 }, "manager", null)).toThrow(/Cabang/);
    expect(() => hitungKomponenOmzet(rows, { source: "klinik", scope: "employee", ratePercent: 0 }, "doctor-a", null)).toThrow(/Persentase/);
  });

  it("does not pay a negative period after returns", () => {
    expect(hitungKomponenOmzet([row(-50_000)], { source: "klinik", scope: "employee", ratePercent: 10 }, "doctor-a", null))
      .toEqual({ basis: -50_000, amount: 0 });
  });
});
