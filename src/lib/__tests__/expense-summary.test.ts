import { expect, it } from "vitest";
import { totalPengeluaranAktif } from "@/lib/expense-summary";

it("excludes canceled expenses from the summary total", () => {
  expect(totalPengeluaranAktif([
    { jumlah: 25000, voided_at: null },
    { jumlah: 10000, voided_at: "2026-10-20T10:00:00Z" },
  ])).toBe(25000);
});
