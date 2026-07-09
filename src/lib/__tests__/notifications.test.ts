import { describe, expect, it } from "vitest";
import { notificationActiveFor, type NotificationRow } from "../notifications";

const base: NotificationRow = {
  id: "n1", title: "T", message: "M", type: "promo", is_active: true, branch_ids: null,
};

describe("notificationActiveFor", () => {
  it("all-branch → active for any branch", () => {
    expect(notificationActiveFor(base, "B1")).toBe(true);
  });
  it("inactive → never active", () => {
    expect(notificationActiveFor({ ...base, is_active: false }, "B1")).toBe(false);
  });
  it("branch match by array membership", () => {
    expect(notificationActiveFor({ ...base, branch_ids: ["B1", "B2"] }, "B1")).toBe(true);
    expect(notificationActiveFor({ ...base, branch_ids: ["B2"] }, "B1")).toBe(false);
  });
  it("empty branch_ids array = all branches", () => {
    expect(notificationActiveFor({ ...base, branch_ids: [] }, "B1")).toBe(true);
  });
});
