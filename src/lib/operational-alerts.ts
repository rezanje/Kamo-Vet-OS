export type AlertRuleKey =
  | "sales_below_target"
  | "stock_opname_variance"
  | "expired_or_near_expiry"
  | "sales_drop"
  | "negative_stock"
  | "manual_discount_limit"
  | "void_limit"
  | "fast_moving_out_of_stock"
  | "no_show_limit"
  | "staff_productivity";

export const ALERT_RULE_KEYS: AlertRuleKey[] = [
  "sales_below_target",
  "stock_opname_variance",
  "expired_or_near_expiry",
  "sales_drop",
  "negative_stock",
  "manual_discount_limit",
  "void_limit",
  "fast_moving_out_of_stock",
  "no_show_limit",
  "staff_productivity",
];

export type AlertSeverity = "red" | "yellow";

export type AlertSetting = {
  ruleKey: AlertRuleKey;
  branchId: string | null;
  threshold: number | null;
  periodDays: number | null;
  active: boolean;
  severity: AlertSeverity;
};

export type AlertMetric = {
  ruleKey: AlertRuleKey;
  branchId: string;
  branchName: string;
  status: "ready" | "missing";
  actual?: number;
  stockQty?: number;
  reason?: string;
  periodLabel: string;
  detailUrl: string;
};

export type OperationalAlert = {
  ruleKey: AlertRuleKey;
  branchId: string;
  branchName: string;
  severity: AlertSeverity;
  actual: number;
  threshold: number;
  periodLabel: string;
  label: string;
  detailUrl: string;
};

export type AlertEvaluation = {
  alerts: OperationalAlert[];
  missing: { ruleKey: AlertRuleKey; reason: string }[];
};

const LABELS: Record<AlertRuleKey, string> = {
  sales_below_target: "Sales di bawah target",
  stock_opname_variance: "Selisih stok opname",
  expired_or_near_expiry: "Stok kedaluwarsa atau mendekati kedaluwarsa",
  sales_drop: "Sales turun",
  negative_stock: "Stok negatif",
  manual_discount_limit: "Diskon manual melewati batas",
  void_limit: "Void melewati batas",
  fast_moving_out_of_stock: "Fast-moving kosong",
  no_show_limit: "No-show melewati batas",
  staff_productivity: "Produktivitas staf di bawah target",
};

export function alertRuleLabel(ruleKey: AlertRuleKey): string {
  return LABELS[ruleKey];
}

const DEFAULTS: AlertSetting[] = [
  { ruleKey: "sales_below_target", branchId: null, threshold: 80, periodDays: 30, active: true, severity: "red" },
  { ruleKey: "stock_opname_variance", branchId: null, threshold: 500_000, periodDays: 1, active: true, severity: "red" },
  { ruleKey: "expired_or_near_expiry", branchId: null, threshold: 30, periodDays: 30, active: true, severity: "red" },
  { ruleKey: "sales_drop", branchId: null, threshold: 10, periodDays: 30, active: true, severity: "yellow" },
  { ruleKey: "negative_stock", branchId: null, threshold: 0, periodDays: 1, active: true, severity: "red" },
  { ruleKey: "manual_discount_limit", branchId: null, threshold: null, periodDays: 30, active: false, severity: "red" },
  { ruleKey: "void_limit", branchId: null, threshold: null, periodDays: 30, active: false, severity: "red" },
  { ruleKey: "fast_moving_out_of_stock", branchId: null, threshold: null, periodDays: 1, active: false, severity: "red" },
  { ruleKey: "no_show_limit", branchId: null, threshold: null, periodDays: 30, active: false, severity: "red" },
  { ruleKey: "staff_productivity", branchId: null, threshold: null, periodDays: 30, active: false, severity: "yellow" },
];

export function defaultAlertSettings(): AlertSetting[] {
  return DEFAULTS.map((setting) => ({ ...setting }));
}

export function resolveAlertSetting(settings: AlertSetting[], ruleKey: AlertRuleKey, branchId: string): AlertSetting | undefined {
  return settings.find((setting) => setting.ruleKey === ruleKey && setting.branchId === branchId)
    ?? settings.find((setting) => setting.ruleKey === ruleKey && setting.branchId === null);
}

function fires(metric: AlertMetric, threshold: number): boolean {
  const actual = metric.actual;
  if (actual === undefined) return false;
  switch (metric.ruleKey) {
    case "sales_below_target":
      return actual < threshold;
    case "stock_opname_variance":
      return actual > threshold;
    case "expired_or_near_expiry":
      return (metric.stockQty ?? 0) > 0 && actual <= threshold;
    case "sales_drop":
      return actual < -threshold;
    case "negative_stock":
      return actual < threshold;
    default:
      return actual > threshold;
  }
}

export function evaluateAlerts(metrics: AlertMetric[], settings: AlertSetting[]): AlertEvaluation {
  const alerts: OperationalAlert[] = [];
  const missing: { ruleKey: AlertRuleKey; reason: string }[] = [];
  const missingKeys = new Set<string>();

  for (const metric of metrics) {
    const setting = resolveAlertSetting(settings, metric.ruleKey, metric.branchId);
    if (!setting || !setting.active || setting.threshold === null) continue;
    if (metric.status === "missing" || metric.actual === undefined) {
      const key = `${metric.ruleKey}:${metric.branchId}`;
      if (!missingKeys.has(key)) {
        missing.push({ ruleKey: metric.ruleKey, reason: metric.reason ?? "Data sumber belum tersedia" });
        missingKeys.add(key);
      }
      continue;
    }
    if (!fires(metric, setting.threshold)) continue;
    alerts.push({
      ruleKey: metric.ruleKey,
      branchId: metric.branchId,
      branchName: metric.branchName,
      severity: setting.severity,
      actual: metric.actual,
      threshold: setting.threshold,
      periodLabel: metric.periodLabel,
      label: LABELS[metric.ruleKey],
      detailUrl: metric.detailUrl,
    });
  }

  alerts.sort((a, b) => (a.severity === "red" ? 0 : 1) - (b.severity === "red" ? 0 : 1)
    || a.branchName.localeCompare(b.branchName)
    || a.ruleKey.localeCompare(b.ruleKey));
  return { alerts, missing };
}
