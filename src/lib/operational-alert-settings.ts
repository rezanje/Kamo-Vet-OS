import {
  ALERT_RULE_KEYS,
  type AlertRuleKey,
  type AlertSetting,
  type AlertSeverity,
} from "./operational-alerts";

type RawAlertSettingInput = {
  ruleKey: string;
  branchId: string;
  threshold: string;
  periodDays: string;
  active: string;
  severity: string;
};

export function validateAlertSettingInput(input: RawAlertSettingInput): AlertSetting {
  if (!ALERT_RULE_KEYS.includes(input.ruleKey as AlertRuleKey)) {
    throw new Error("Aturan alert tidak valid");
  }
  if (input.severity !== "red" && input.severity !== "yellow") {
    throw new Error("Prioritas alert tidak valid");
  }

  const active = input.active === "on" || input.active === "true";
  const threshold = input.threshold.trim() === "" ? null : Number(input.threshold);
  const periodDays = Number(input.periodDays);
  if (active && threshold === null) throw new Error("Ambang wajib diisi untuk alert aktif");
  if (
    (threshold !== null && (!Number.isFinite(threshold) || threshold < 0))
    || !Number.isInteger(periodDays)
    || periodDays <= 0
  ) {
    throw new Error("Ambang dan periode belum valid");
  }

  return {
    ruleKey: input.ruleKey as AlertRuleKey,
    branchId: input.branchId.trim() || null,
    threshold,
    periodDays,
    active,
    severity: input.severity as AlertSeverity,
  };
}
