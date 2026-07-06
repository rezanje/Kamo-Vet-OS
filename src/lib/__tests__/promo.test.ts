import { describe, expect, it } from "vitest";
import { promoActiveFor, promoScheduleStatus, type PromoRow } from "../promo";

const base: PromoRow = {
  id: "p1", name: "Promo", promo_type: "diskon_produk", rule: {},
  is_active: true, branch_ids: null, valid_from: null, valid_until: null,
};

describe("promoActiveFor", () => {
  it("all-branch, unbounded dates → active for any branch/today", () => {
    expect(promoActiveFor(base, "B1", "2026-07-07")).toBe(true);
  });
  it("inactive → never active", () => {
    expect(promoActiveFor({ ...base, is_active: false }, "B1", "2026-07-07")).toBe(false);
  });
  it("branch match by array membership", () => {
    expect(promoActiveFor({ ...base, branch_ids: ["B1", "B2"] }, "B1", "2026-07-07")).toBe(true);
    expect(promoActiveFor({ ...base, branch_ids: ["B2"] }, "B1", "2026-07-07")).toBe(false);
  });
  it("empty branch_ids array = all branches", () => {
    expect(promoActiveFor({ ...base, branch_ids: [] }, "B1", "2026-07-07")).toBe(true);
  });
  it("before valid_from → inactive", () => {
    expect(promoActiveFor({ ...base, valid_from: "2026-07-08" }, "B1", "2026-07-07")).toBe(false);
  });
  it("after valid_until → inactive", () => {
    expect(promoActiveFor({ ...base, valid_until: "2026-07-06" }, "B1", "2026-07-07")).toBe(false);
  });
  it("within date range → active", () => {
    expect(promoActiveFor({ ...base, valid_from: "2026-07-01", valid_until: "2026-07-31" }, "B1", "2026-07-07")).toBe(true);
  });
});

describe("promoScheduleStatus", () => {
  it("nonaktif when is_active false", () => {
    expect(promoScheduleStatus({ ...base, is_active: false }, "2026-07-07")).toBe("nonaktif");
  });
  it("kadaluarsa when valid_until before today", () => {
    expect(promoScheduleStatus({ ...base, valid_until: "2026-07-06" }, "2026-07-07")).toBe("kadaluarsa");
  });
  it("terjadwal when valid_from after today", () => {
    expect(promoScheduleStatus({ ...base, valid_from: "2026-07-10" }, "2026-07-07")).toBe("terjadwal");
  });
  it("aktif when within / unbounded", () => {
    expect(promoScheduleStatus(base, "2026-07-07")).toBe("aktif");
  });
});
