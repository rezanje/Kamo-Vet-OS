// H02: effective salary components = the employee's payslip template, then explicit
// per-employee rows. Pure, tested in __tests__/payslip-template.test.ts.

export type KomponenMaster = {
  nama: string;
  tipe: string;
  nominal: number;
  is_active: boolean;
  calculation_basis: string;
  sales_source: string;
  sales_scope: string;
  rate_percent: number;
};

export type BarisTemplate = { component_id: string; nominal: number | null; rate_percent: number | null; master: KomponenMaster };
export type BarisKaryawan = { component_id: string; nominal: number | null; rate_percent_override: number | null; master: KomponenMaster };

export type AsalKomponen = "template" | "pengecualian" | "individu";

export type KomponenEfektif = {
  componentId: string;
  master: KomponenMaster;
  /** Fixed amount after template/exception (null only for turnover components). */
  nominal: number;
  /** Turnover rate after template/exception. */
  ratePercent: number;
  asal: AsalKomponen;
};

/**
 * Template values override the component master; an employee row on the same component
 * is an explicit exception and overrides only the values it sets. Employee rows on other
 * components are individual extras. Inactive master components are skipped.
 */
export function komponenEfektif(template: readonly BarisTemplate[], karyawan: readonly BarisKaryawan[]): KomponenEfektif[] {
  const out = new Map<string, KomponenEfektif>();
  for (const row of template) {
    out.set(row.component_id, {
      componentId: row.component_id, master: row.master, asal: "template",
      nominal: Number(row.nominal ?? row.master.nominal),
      ratePercent: Number(row.rate_percent ?? row.master.rate_percent),
    });
  }
  for (const row of karyawan) {
    const base = out.get(row.component_id);
    out.set(row.component_id, base
      ? { ...base, asal: "pengecualian",
        nominal: row.nominal === null ? base.nominal : Number(row.nominal),
        ratePercent: row.rate_percent_override === null ? base.ratePercent : Number(row.rate_percent_override) }
      : { componentId: row.component_id, master: row.master, asal: "individu",
        nominal: Number(row.nominal ?? row.master.nominal),
        ratePercent: Number(row.rate_percent_override ?? row.master.rate_percent) });
  }
  return [...out.values()].filter((row) => row.master.is_active);
}
