import { describe, expect, it } from "vitest";
import {
  defaultAlertSettings,
  evaluateAlerts,
  resolveAlertSetting,
  type AlertMetric,
  type AlertSetting,
} from "../operational-alerts";

const setting = (ruleKey: AlertSetting["ruleKey"], threshold: number | null, active = true): AlertSetting => ({
  ruleKey,
  branchId: null,
  threshold,
  periodDays: 30,
  active,
  severity: "red",
});

const metric = (ruleKey: AlertMetric["ruleKey"], actual: number, extra: Partial<AlertMetric> = {}): AlertMetric => ({
  ruleKey,
  branchId: "b1",
  branchName: "Cabang Satu",
  status: "ready",
  actual,
  periodLabel: "Agustus 2026",
  detailUrl: "/laporan/penjualan-rinci",
  ...extra,
});

describe("operational alerts", () => {
  it("branch override menang atas setting perusahaan", () => {
    const settings = [
      { ...setting("sales_below_target", 80), periodDays: 30 },
      { ...setting("sales_below_target", 75), branchId: "b1", severity: "yellow" as const },
    ];
    expect(resolveAlertSetting(settings, "sales_below_target", "b1")?.threshold).toBe(75);
  });

  it("hanya lima rule client yang aktif otomatis", () => {
    expect(defaultAlertSettings().filter((item) => item.active).map((item) => item.ruleKey).sort()).toEqual([
      "expired_or_near_expiry", "negative_stock", "sales_below_target", "sales_drop", "stock_opname_variance",
    ]);
  });

  it("memakai batas ketat untuk target, opname, expiry, growth, dan stok negatif", () => {
    expect(evaluateAlerts([metric("sales_below_target", 79.99)], [setting("sales_below_target", 80)]).alerts).toHaveLength(1);
    expect(evaluateAlerts([metric("sales_below_target", 80)], [setting("sales_below_target", 80)]).alerts).toHaveLength(0);
    expect(evaluateAlerts([metric("stock_opname_variance", 500_001)], [setting("stock_opname_variance", 500_000)]).alerts).toHaveLength(1);
    expect(evaluateAlerts([metric("stock_opname_variance", 500_000)], [setting("stock_opname_variance", 500_000)]).alerts).toHaveLength(0);
    expect(evaluateAlerts([metric("expired_or_near_expiry", 30, { stockQty: 1 })], [setting("expired_or_near_expiry", 30)]).alerts).toHaveLength(1);
    expect(evaluateAlerts([metric("expired_or_near_expiry", 30, { stockQty: 0 })], [setting("expired_or_near_expiry", 30)]).alerts).toHaveLength(0);
    expect(evaluateAlerts([metric("sales_drop", -10.01)], [setting("sales_drop", 10)]).alerts).toHaveLength(1);
    expect(evaluateAlerts([metric("sales_drop", -10)], [setting("sales_drop", 10)]).alerts).toHaveLength(0);
    expect(evaluateAlerts([metric("negative_stock", -0.01)], [setting("negative_stock", 0)]).alerts).toHaveLength(1);
  });

  it("aturan nonaktif atau tanpa ambang tidak menyalakan alert", () => {
    expect(evaluateAlerts([metric("sales_below_target", 1)], [setting("sales_below_target", null)])).toEqual({ alerts: [], missing: [] });
    expect(evaluateAlerts([metric("sales_below_target", 1)], [setting("sales_below_target", 80, false)])).toEqual({ alerts: [], missing: [] });
  });

  it("sumber missing menghasilkan diagnostik tanpa alert sehat palsu", () => {
    const result = evaluateAlerts([{ ...metric("negative_stock", 0), status: "missing", reason: "stock belum tersedia" }], [setting("negative_stock", 0)]);
    expect(result.alerts).toEqual([]);
    expect(result.missing).toEqual([{ ruleKey: "negative_stock", reason: "stock belum tersedia" }]);
  });

  it("mengurutkan merah sebelum kuning lalu cabang", () => {
    const metrics = [
      metric("sales_drop", -20, { branchId: "b2", branchName: "Zeta" }),
      metric("negative_stock", -1, { branchId: "b1", branchName: "Alpha" }),
    ];
    const settings = [
      { ...setting("sales_drop", 10), severity: "yellow" as const },
      setting("negative_stock", 0),
    ];
    expect(evaluateAlerts(metrics, settings).alerts.map((alert) => alert.ruleKey)).toEqual(["negative_stock", "sales_drop"]);
  });
});
