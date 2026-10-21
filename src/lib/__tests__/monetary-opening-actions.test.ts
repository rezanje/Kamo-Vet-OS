import { beforeEach, expect, it, vi } from "vitest";
const { rpc, guard, redirect } = vi.hoisted(() => ({
  rpc: vi.fn(), guard: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(url); }),
}));
vi.mock("@/lib/master-guard", () => ({ assertRole: guard }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { previewMonetaryOpening, correctMonetaryOpening } from "@/app/(app)/kas-bank/rekening/[id]/saldo-awal/actions";

beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ rpc }); });
function input() {
  const f = new FormData();
  for (const [k, v] of Object.entries({ account_id: "cash-id", amount: "5000000", reason: "Salah input angka pembuka", preview: '{"revision":0}', draft_key: "stable-key", draft_scope: "monetary-opening:cash-id" })) f.set(k, v);
  return f;
}
it("uses OWNER guard and a read-only database preview", async () => {
  rpc.mockResolvedValue({ data: { old_amount: 50000000, new_amount: 5000000 }, error: null });
  expect(await previewMonetaryOpening(input())).toEqual({ preview: { old_amount: 50000000, new_amount: 5000000 } });
  expect(guard).toHaveBeenCalledWith("/kas-bank/rekening", "saldo awal moneter", ["OWNER"]);
  expect(rpc).toHaveBeenCalledWith("preview_monetary_opening", { p_account_id: "cash-id", p_new_amount: "5000000", p_reason: "Salah input angka pembuka" });
});
it("passes the exact reviewed evidence to one atomic correction and acknowledges only confirmed results", async () => {
  rpc.mockResolvedValue({ data: { correction_id: "audit", replacement_entry_id: "replacement" }, error: null });
  await expect(correctMonetaryOpening(input())).rejects.toThrow("success=");
  expect(rpc).toHaveBeenCalledWith("correct_monetary_opening", { p_account_id: "cash-id", p_new_amount: "5000000", p_reason: "Salah input angka pembuka", p_preview: { revision: 0 }, p_request_key: "stable-key" });
  expect(redirect.mock.calls[0][0]).toContain("draft_done=stable-key");
});
it.each([{ data: null, error: { message: "Preview berubah" } }, { data: null, error: null }])("retains the draft when correction is unconfirmed", async result => {
  rpc.mockResolvedValue(result);
  await expect(correctMonetaryOpening(input())).rejects.toThrow("error=");
  expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});
it("rejects absent preview or retry identity before posting", async () => {
  const f = input(); f.delete("draft_key");
  await expect(correctMonetaryOpening(f)).rejects.toThrow("error=");
  f.set("draft_key", "key"); f.set("preview", "null");
  await expect(correctMonetaryOpening(f)).rejects.toThrow("error=");
  expect(rpc).not.toHaveBeenCalled();
});
it("recovers a previously committed response without creating another correction", async () => {
  const f = input(); f.set("intent", "recover");
  rpc.mockResolvedValue({ data: { correction_id: "audit" }, error: null });
  await expect(correctMonetaryOpening(f)).rejects.toThrow("success=");
  expect(rpc).toHaveBeenCalledWith("get_monetary_opening_result", { p_account_id: "cash-id", p_request_key: "stable-key" });
});
