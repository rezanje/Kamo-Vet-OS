import type { AturanGaji } from "./payroll-aturan";
export type PolicyVersion = {
  id: string;
  sequence?: number;
  effective_date: string;
  group_id: string | null;
  values: AturanGaji;
};
export type PayMembership = {
  id: string;
  employee_id: string;
  group_id: string;
  valid_from: string;
  valid_to: string | null;
};
export type MasterVersion = {
  id: string;
  sequence?: number;
  component_id: string;
  effective_period: string;
  nama: string;
  tipe: string;
  nominal: number;
  is_active: boolean;
};
export type FixedVersion = {
  id: string;
  employee_id: string;
  sequence?: number;
  component_id: string;
  effective_period: string;
  nominal: number | null;
  is_active: boolean;
};
export type VariableComponent = {
  id: string;
  employee_id: string;
  periode: string;
  nama: string;
  tipe: string;
  nominal: number;
  is_active: boolean;
};
function latest<T extends { id: string; sequence?: number }>(
  rows: T[],
  key: (r: T) => string,
  limit: string,
): T | undefined {
  const eligible = rows
    .filter((r) => key(r) <= limit)
    .sort(
      (a, b) =>
        key(b).localeCompare(key(a)) || (b.sequence ?? 0) - (a.sequence ?? 0),
    );
  if (
    eligible.length > 1 &&
    key(eligible[0]) === key(eligible[1]) &&
    (eligible[0].sequence ?? 0) === (eligible[1].sequence ?? 0)
  )
    throw new Error("Data gaji: versi konfigurasi bertumpang tindih");
  return eligible[0];
}
export function resolvePayrollPolicy(
  employee: string,
  date: string,
  baseline: AturanGaji,
  policies: PolicyVersion[],
  members: PayMembership[],
): AturanGaji {
  const own = members.filter(
    (m) =>
      m.employee_id === employee &&
      m.valid_from <= date &&
      (!m.valid_to || m.valid_to >= date),
  );
  if (own.length > 1)
    throw new Error("Data gaji: kelompok karyawan bertumpang tindih");
  const group = own[0]
    ? latest(
        policies.filter((p) => p.group_id === own[0].group_id),
        (p) => p.effective_date,
        date,
      )
    : undefined;
  const global = latest(
    policies.filter((p) => p.group_id === null),
    (p) => p.effective_date,
    date,
  );
  const result = { ...(group?.values ?? global?.values ?? baseline) };
  if (
    Object.keys(baseline).some(
      (k) =>
        typeof result[k as keyof AturanGaji] !== "number" ||
        !Number.isFinite(result[k as keyof AturanGaji]) ||
        result[k as keyof AturanGaji] < 0,
    ) ||
    result.telat_blok_menit <= 0
  )
    throw new Error("Data gaji: aturan bertanggal tidak valid");
  return result;
}
export function componentsForPeriod(
  employee: string,
  period: string,
  masters: MasterVersion[],
  fixed: FixedVersion[],
  variables: VariableComponent[],
) {
  const result: {
    id: string;
    nama: string;
    tipe: "tunjangan" | "potongan";
    nominal: number;
    source: string;
    version: string;
  }[] = [];
  const own = fixed.filter((v) => v.employee_id === employee);
  for (const component of new Set(own.map((v) => v.component_id))) {
    const binding = latest(
      own.filter((v) => v.component_id === component),
      (v) => v.effective_period,
      period,
    );
    const master = latest(
      masters.filter((v) => v.component_id === component),
      (v) => v.effective_period,
      period,
    );
    if (!binding?.is_active || !master?.is_active) continue;
    const amount = Number(binding.nominal ?? master.nominal);
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      (master.tipe !== "tunjangan" && master.tipe !== "potongan")
    )
      throw new Error("Data gaji: komponen bertanggal tidak valid");
    result.push({
      id: component,
      nama: master.nama,
      tipe: master.tipe,
      nominal: amount,
      source: "fixed",
      version: binding.id + ":" + master.id,
    });
  }
  for (const v of variables.filter(
    (v) => v.employee_id === employee && v.periode === period && v.is_active,
  )) {
    if (
      !Number.isFinite(Number(v.nominal)) ||
      Number(v.nominal) < 0 ||
      (v.tipe !== "tunjangan" && v.tipe !== "potongan")
    )
      throw new Error("Data gaji: komponen periode tidak valid");
    result.push({
      id: v.id,
      nama: v.nama,
      tipe: v.tipe,
      nominal: Number(v.nominal),
      source: "period",
      version: v.id,
    });
  }
  return result;
}
