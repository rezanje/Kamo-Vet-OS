import { describe, expect, it } from "vitest";
import { validateAlertSettingInput } from "../operational-alert-settings";

describe("validateAlertSettingInput", () => {
  it("menerima ambang nol untuk stok negatif", () => {
    expect(validateAlertSettingInput({
      ruleKey: "negative_stock",
      branchId: "branch-a",
      threshold: "0",
      periodDays: "1",
      active: "on",
      severity: "red",
    })).toEqual({
      ruleKey: "negative_stock",
      branchId: "branch-a",
      threshold: 0,
      periodDays: 1,
      active: true,
      severity: "red",
    });
  });

  it("menerima ambang kosong hanya saat aturan tidak aktif", () => {
    expect(validateAlertSettingInput({
      ruleKey: "void_limit",
      branchId: "",
      threshold: "",
      periodDays: "30",
      active: "",
      severity: "yellow",
    }).threshold).toBeNull();

    expect(() => validateAlertSettingInput({
      ruleKey: "void_limit",
      branchId: "",
      threshold: "",
      periodDays: "30",
      active: "on",
      severity: "yellow",
    })).toThrow("Ambang wajib diisi");
  });

  it("menolak aturan, angka, dan periode yang tidak valid", () => {
    expect(() => validateAlertSettingInput({
      ruleKey: "unknown",
      branchId: "",
      threshold: "10",
      periodDays: "30",
      active: "on",
      severity: "red",
    })).toThrow("Aturan alert tidak valid");

    expect(() => validateAlertSettingInput({
      ruleKey: "sales_drop",
      branchId: "",
      threshold: "-1",
      periodDays: "0",
      active: "on",
      severity: "red",
    })).toThrow("Ambang dan periode belum valid");
  });
});
