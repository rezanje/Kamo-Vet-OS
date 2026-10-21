import { beforeEach, expect, it, vi } from "vitest";
const { rpc, guard, redirect } = vi.hoisted(() => ({ rpc: vi.fn(), guard: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(url); }) }));
vi.mock("@/lib/master-guard", () => ({ assertRole: guard }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { buatTransfer, batalkanTransfer, koreksiTransfer } from "@/app/(app)/kas-bank/transfer/actions";
beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ rpc }); rpc.mockResolvedValue({ data: { transfer_id: "transfer", no_transfer: "TF.1", revision: 0, journal_entry_id: "journal", reversal_journal_id: "reversal", replacement_transfer_id: "replacement", replacement_journal_id: "replacement-journal" }, error: null }); });
function form() { const data = new FormData(); for (const [key, value] of Object.entries({ tanggal: "2026-10-20", from_account_id: "cash", to_account_id: "bank", jumlah: "100.25", biaya_admin: "1.25", branch_id: "branch", keterangan: "Transfer test", draft_key: "transfer-key", draft_scope: "bank-transfer-create", id: "transfer", revision: "0", reason: "Koreksi simulasi" })) data.set(key, value); return data; }
it("creates both ledger sides with a single durable atomic RPC", async () => {
  await expect(buatTransfer(form())).rejects.toThrow("success=1");
  expect(rpc).toHaveBeenCalledWith("mutate_cash_transfer", expect.objectContaining({ p_request_key: "transfer-key", p_action: "create", p_transfer_id: null }));
  expect(redirect.mock.calls[0][0]).toContain("draft_done=transfer-key");
});
it.each([[koreksiTransfer, "edit"], [batalkanTransfer, "void"]] as const)("requires OWNER for corrections and cancellation", async (action, mode) => {
  await expect(action(form())).rejects.toThrow("success=");
  expect(guard).toHaveBeenCalledWith("/kas-bank/transfer", "catatan transfer", ["OWNER"]);
  expect(rpc).toHaveBeenCalledWith("mutate_cash_transfer", expect.objectContaining({ p_action: mode, p_transfer_id: "transfer", p_expected_revision: 0, p_reason: "Koreksi simulasi" }));
});
it("recovers a committed result read-only even when form fields are invalid", async () => {
  const data = form(); data.set("tindakan", "periksa"); data.delete("jumlah");
  await expect(koreksiTransfer(data)).rejects.toThrow("success=koreksi");
  expect(rpc).toHaveBeenCalledWith("get_cash_transfer_result", { p_request_key: "transfer-key" });
});
it.each([{ data: null, error: { message: "Periode akuntansi sudah ditutup" } }, { data: { transfer_id: "transfer" }, error: null }])("never acknowledges rejected or incomplete results", async response => {
  rpc.mockResolvedValue(response); await expect(koreksiTransfer(form())).rejects.toThrow();
  expect(redirect.mock.calls.every(([url]) => !url.includes("draft_done"))).toBe(true);
});
it("rejects missing identity without writing", async () => { const data = form(); data.delete("draft_key"); await expect(buatTransfer(data)).rejects.toThrow("error="); expect(rpc).not.toHaveBeenCalled(); });
it("explains concurrent lock failures without acknowledging the draft", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "55P03", message: "lock timeout" } });
  await expect(koreksiTransfer(form())).rejects.toThrow(encodeURIComponent("Catatan sedang diproses"));
  expect(redirect.mock.calls[0][0]).toContain("koreksi=transfer&error=");
  expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});
it("recovers a correction whose original is already voided without calling mutation", async () => {
  const { pulihkanTransfer } = await import("@/app/(app)/kas-bank/transfer/actions");
  rpc.mockResolvedValue({ data: { action: "edit", transfer_id: "transfer", journal_entry_id: "journal", reversal_journal_id: "reversal", replacement_transfer_id: "replacement", replacement_journal_id: "replacement-journal" }, error: null });
  await expect(pulihkanTransfer(form())).rejects.toThrow("success=koreksi");
  expect(rpc).toHaveBeenCalledWith("get_cash_transfer_result", { p_request_key: "transfer-key" });
  expect(rpc).toHaveBeenCalledTimes(1);
});
