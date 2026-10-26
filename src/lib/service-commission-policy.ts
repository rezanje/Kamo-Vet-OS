import { cocokAturanKomisi, type AturanKomisi, type BarisJual } from "./komisi";

export type ServiceCommissionMode = "pending" | "personal_rules" | "both_full" | "split";
export type ServiceCommissionPolicy = {
  id: string;
  branchId: string | null;
  effectiveFrom: string;
  mode: ServiceCommissionMode;
  doctorSharePct: number | null;
  staffSharePct: number | null;
  createdAt: string;
};

function validPolicy(policy: ServiceCommissionPolicy): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.effectiveFrom)) return false;
  if (policy.mode === "split") return policy.doctorSharePct !== null && policy.staffSharePct !== null
    && Number.isFinite(policy.doctorSharePct) && Number.isFinite(policy.staffSharePct)
    && policy.doctorSharePct >= 0 && policy.staffSharePct >= 0
    && policy.doctorSharePct + policy.staffSharePct === 100;
  return (policy.mode === "pending" || policy.mode === "personal_rules" || policy.mode === "both_full")
    && policy.doctorSharePct === null && policy.staffSharePct === null;
}

function selectedPolicy(row: BarisJual, policies: readonly ServiceCommissionPolicy[]): ServiceCommissionPolicy | null {
  const date = row.commissionPolicyDate ?? row.tanggal;
  const candidates = policies.filter(policy => policy.effectiveFrom <= date
    && (policy.branchId === row.branchId || policy.branchId === null));
  const scoped = row.branchId ? candidates.filter(policy => policy.branchId === row.branchId) : [];
  const chosen = (scoped.length ? scoped : candidates.filter(policy => policy.branchId === null))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)
      || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  return chosen ?? null;
}

function allocated(value: number, doctorShare: number): [number, number] {
  const doctor = Number((value * doctorShare / 100).toFixed(4));
  return [doctor, value - doctor];
}

/** Source rows stay unique. Only calculation rows are projected per saved actor. */
export function prepareServiceCommission(
  sourceRows: readonly BarisJual[], rules: readonly AturanKomisi[], policies: readonly ServiceCommissionPolicy[],
): { rows: BarisJual[]; calculationRows: BarisJual[]; resolvedUnassignedOmzet: number } {
  const rows: BarisJual[] = [], calculationRows: BarisJual[] = [];
  let resolvedUnassignedOmzet = 0;
  for (const source of sourceRows) {
    if (!source.commissionPending || source.fixedCommission || !source.servicePerformers) {
      rows.push(source); calculationRows.push(source); continue;
    }
    const { doctor_id: doctorId, staff_id: staffId } = source.servicePerformers;
    if (!doctorId || !staffId || doctorId === staffId) {
      rows.push(source); calculationRows.push(source); continue;
    }
    const policy = selectedPolicy(source, policies);
    if (!policy || !validPolicy(policy)) {
      rows.push(source); calculationRows.push(source); continue;
    }
    if (policy.mode === "pending") {
      const pending = { ...source, commissionPolicyWarning: "Kebijakan menahan komisi dua pelaksana." };
      rows.push(pending); calculationRows.push(pending); continue;
    }
    const resolvedMode: Exclude<ServiceCommissionMode,"pending"> = policy.mode;
    const doctorShare = policy.mode === "split" ? policy.doctorSharePct! : 100;
    const qty = policy.mode === "split" ? allocated(source.qty, doctorShare) : [source.qty, source.qty];
    const omzet = policy.mode === "split" ? allocated(source.omzet, doctorShare) : [source.omzet, source.omzet];
    const laba = source.laba === null ? [null, null] : policy.mode === "split"
      ? allocated(source.laba, doctorShare) : [source.laba, source.laba];
    const actors = [doctorId, staffId].map((employeeId, index): BarisJual => ({
      ...source, employeeId, qty: qty[index], omzet: omzet[index], laba: laba[index],
      commissionPending: false, commissionPolicy: resolvedMode,
      personalRulesOnly: policy.mode === "personal_rules",
    }));
    const uncovered = actors.some(actor => (policy.mode !== "split" || actor.qty !== 0)
      && !rules.some(rule => cocokAturanKomisi(actor, rule)));
    if (uncovered) {
      const pending = { ...source, commissionPolicyWarning: "Aturan aktif belum cocok untuk setiap pelaksana." };
      rows.push(pending); calculationRows.push(pending); continue;
    }
    rows.push({ ...source, commissionPending: false, commissionPolicy: resolvedMode, commissionPolicyWarning: undefined });
    calculationRows.push(...actors);
    resolvedUnassignedOmzet += source.omzet;
  }
  return { rows, calculationRows, resolvedUnassignedOmzet };
}
