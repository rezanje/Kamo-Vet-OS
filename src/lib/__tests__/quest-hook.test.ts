import { afterEach, expect, it, vi } from "vitest";
import { processQuestProgress } from "@/lib/quest-hook";

// Q01: quest progress is best effort for the checkout, but a failed call is repaired by the
// next checkout (apply_pending_sale_staff_effects), then this sale is applied explicitly.
afterEach(() => vi.restoreAllMocks());
function client(fail: Record<string, "error" | "throw"> = {}) {
  const calls: { name: string; params?: unknown }[] = [];
  return { calls, rpc: async (name: string, params?: unknown) => {
    calls.push({ name, params });
    if (fail[name] === "throw") throw Error("network down");
    return { data: fail[name] ? null : { applied: true }, error: fail[name] ? { message: "db unavailable" } : null };
  } };
}

it("repairs pending effects first, then applies this sale", async () => {
  const c = client();
  await processQuestProgress(c, { saleId: "sale-1" });
  expect(c.calls).toEqual([{ name: "apply_pending_sale_staff_effects", params: undefined },
    { name: "apply_sale_staff_effects", params: { p_sale_id: "sale-1" } }]);
});

it.each(["error", "throw"] as const)("never blocks the checkout when the repair call fails (%s)", async (mode) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const c = client({ apply_pending_sale_staff_effects: mode });
  await expect(processQuestProgress(c, { saleId: "sale-1" })).resolves.toBeUndefined();
  expect(c.calls.map((x) => x.name)).toEqual(["apply_pending_sale_staff_effects", "apply_sale_staff_effects"]);
  expect(log).toHaveBeenCalled();
});

it.each(["error", "throw"] as const)("never blocks the checkout when this sale's call fails (%s)", async (mode) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(processQuestProgress(client({ apply_sale_staff_effects: mode }), { saleId: "sale-1" })).resolves.toBeUndefined();
  expect(String(log.mock.calls[0]?.[0])).toContain("retried on the next checkout");
});
