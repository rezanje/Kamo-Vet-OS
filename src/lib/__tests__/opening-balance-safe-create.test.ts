import { beforeEach, expect, it, vi } from "vitest";
const { rpc, guard, redirect } = vi.hoisted(() => ({ rpc: vi.fn(), guard: vi.fn(), redirect: vi.fn((url: string): never => { throw new Error(url); }) }));
vi.mock("@/lib/master-guard", () => ({ assertRole: guard }));
vi.mock("@/lib/supabase/server", () => ({ createClient: guard }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { simpanSaldoAwal, hapusSaldoAwal } from "@/app/(app)/keuangan/saldo-awal/actions";
beforeEach(() => { vi.clearAllMocks(); guard.mockResolvedValue({ rpc }); });
it("creates the existing opening atomically without deleting any ledger history", async () => {
  rpc.mockResolvedValue({ data: { entry_id: "opening" }, error: null });
  const f = new FormData(); f.set("tanggal", "2026-10-20"); f.set("baris", '[{"code":"1101","nilai":500,"sisi":"D"}]'); f.set("draft_key", "initial-key"); f.set("draft_scope", "opening-balance-create");
  await expect(simpanSaldoAwal(f)).rejects.toThrow("success=");
  expect(rpc).toHaveBeenCalledWith("create_opening_balance_atomic", { p_request_key: "initial-key", p_tanggal: "2026-10-20", p_rows: [{ code: "1101", nilai: 500, sisi: "D" }] });
  expect(redirect.mock.calls[0][0]).toContain("draft_done=initial-key");
});
it("rejects the legacy destructive delete route", async () => {
  await expect(hapusSaldoAwal()).rejects.toThrow("error=");
  expect(rpc).not.toHaveBeenCalled();
});
