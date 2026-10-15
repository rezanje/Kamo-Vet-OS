import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: fixture.rpc }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(Error(url), { digest: "NEXT_REDIRECT" }); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import * as actions from "@/app/(app)/pos/expense/actions";
const id = "ee400000-0000-4000-8000-000000000001";
function form() {
  const data = new FormData();
  Object.entries({ id, revision: "2", request_key: "correction-key", draft_key: "correction-key", draft_scope: `expense-edit:${id}:2`,
    kembali: "/buku-besar/beban", tanggal: "2026-10-15", kategori: "Operasional", deskripsi: "Corrected", jumlah: "30000", metode_bayar: "Tunai", alasan: "Salah nominal", branchId: "forged", created_by: "forged" }).forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => { vi.clearAllMocks(); fixture.rpc.mockResolvedValue({ data: { expense_id: id, journal_id: "journal" }, error: null }); });

it.each([["ubahExpense", "edit"], ["batalkanExpense", "void"]] as const)("%s uses the authorized audited RPC with stale-edit protection", async (name, kind) => {
  const action = actions[name as keyof typeof actions];
  expect(typeof action).toBe("function");
  await expect(action(form())).rejects.toThrow(`/buku-besar/beban/${id}?success=${kind}`);
  expect(fixture.rpc).toHaveBeenCalledWith("revise_expense_atomic", expect.objectContaining({ p_request_key: "correction-key", p_expense_id: id, p_expected_revision: 2, p_action: kind, p_reason: "Salah nominal" }));
  const [, payload] = fixture.rpc.mock.calls[0];
  expect(payload).not.toHaveProperty("branchId");
  expect(payload.p_expense).not.toHaveProperty("created_by");
});

it("preserves corrections when the accounting period or shift rejects them", async () => {
  const action = actions["ubahExpense" as keyof typeof actions]; expect(typeof action).toBe("function");
  fixture.rpc.mockResolvedValue({ data: null, error: { message: "Shift sudah ditutup" } });
  await expect(action(form())).rejects.toThrow("Shift sudah ditutup");
});

it("requires a correction reason before mutation", async () => {
  const action = actions["batalkanExpense" as keyof typeof actions]; expect(typeof action).toBe("function");
  const data = form(); data.set("alasan", " ");
  await expect(action(data)).rejects.toThrow("Alasan"); expect(fixture.rpc).not.toHaveBeenCalled();
});

it("recovers the exact committed cashier request before starting a new expense", async () => {
  const action = actions["periksaExpense" as keyof typeof actions]; expect(typeof action).toBe("function");
  const data = form(); data.set("draft_scope", "cashier-expense:closed-shift");
  await expect(action(data)).rejects.toThrow("/kasir/pengeluaran?success=1&draft_done=correction-key");
  expect(fixture.rpc).toHaveBeenCalledWith("get_expense_posting_result", { p_request_key: "correction-key" });
});

it("does not retire a request when recovery finds no committed expense", async () => {
  const action = actions["periksaExpense" as keyof typeof actions]; expect(typeof action).toBe("function");
  fixture.rpc.mockResolvedValue({ data: null, error: null });
  await expect(action(form())).rejects.toThrow("Belum ada pengeluaran");
});
