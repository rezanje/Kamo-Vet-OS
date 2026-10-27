import type { BarisJual, SumberJual } from "./komisi";

export type TurnoverComponent = {
  source: Exclude<SumberJual, "visit_ranap"> | "semua";
  scope: "employee" | "own_branch" | "all_branches";
  ratePercent: number;
};

/** Posted net sales rows already include discounts and negative returns. */
export function hitungKomponenOmzet(
  rows: readonly BarisJual[],
  component: TurnoverComponent,
  employeeId: string,
  branchId: string | null,
): { basis: number; amount: number } {
  if (!Number.isFinite(component.ratePercent) || component.ratePercent <= 0 || component.ratePercent > 100) {
    throw new Error("Persentase komponen omzet belum valid.");
  }
  if (component.scope === "own_branch" && !branchId) {
    throw new Error("Cabang karyawan wajib diisi untuk komponen omzet cabang.");
  }
  const basis = rows.reduce((total, row) => {
    // Inpatient visits (H06) are paid by commission rules, never counted as turnover.
    if (row.sumber === "visit_ranap") return total;
    if (component.source !== "semua" && row.sumber !== component.source) return total;
    if (component.scope === "employee" && row.employeeId !== employeeId) return total;
    if (component.scope === "own_branch" && row.branchId !== branchId) return total;
    if (!Number.isFinite(row.omzet)) throw new Error("Omzet transaksi belum valid.");
    return total + row.omzet;
  }, 0);
  return { basis: Math.round(basis), amount: Math.max(0, Math.round(basis * component.ratePercent / 100)) };
}
