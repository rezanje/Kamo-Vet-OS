import { expect, it, vi } from "vitest";
import { requireRoleAction } from "../role-action-access";

it("requires an error-free authoritative true, never role or actor supplied by callers", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  await expect(requireRoleAction({ rpc }, "bank.cash_transfer.create")).resolves.toBeUndefined();
  expect(rpc).toHaveBeenCalledExactlyOnceWith("role_action_allowed", { p_action: "bank.cash_transfer.create" });
});
it("fails closed on denial, malformed response, read errors and thrown transport errors", async () => {
  for (const response of [null, {}, { data: true }, { data: true, error: "" }, { data: false, error: null }, { data: "true", error: null }, { data: 1, error: null }, { data: true, error: { message: "read failed" } }]) {
    await expect(requireRoleAction({ rpc: vi.fn().mockResolvedValue(response) }, "unknown")).rejects.toThrow();
  }
  await expect(requireRoleAction({ rpc: vi.fn().mockRejectedValue(new Error("transport")) }, "bank.cash_transfer.create")).rejects.toThrow();
});
