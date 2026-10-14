import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ inserted: [] as Record<string, unknown>[], branchId: "branch-a", user: "staff-a" as string | null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: fixture.branchId }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: fixture.user ? { id: fixture.user } : null } }) },
  from: () => ({ insert: async (row: Record<string, unknown>) => { fixture.inserted.push(row); return { error: null }; } }),
}) }));
import { mulaiShiftKlinik } from "@/app/(app)/klinik/shift/actions";
beforeEach(() => { fixture.inserted = []; fixture.branchId = "branch-a"; fixture.user = "staff-a"; });
function form(cash?: string) { const f = new FormData(); f.set("branchId", "branch-a"); if (cash !== undefined) f.set("opening_balance", cash); return f; }
it.each([undefined, "", " ", "bad", "-1", "Infinity", "NaN"])("rejects invalid opening cash %s before saving a shift", async cash => {
  await expect(mulaiShiftKlinik(form(cash))).rejects.toThrow("REDIRECT:/klinik/shift?error=");
  expect(fixture.inserted).toHaveLength(0);
});
it.each(["0", "150000", "250000.50"])("persists explicitly entered opening cash %s on the current user's clinic shift", async cash => {
  await expect(mulaiShiftKlinik(form(cash))).rejects.toThrow("REDIRECT:/klinik?success=shift");
  expect(fixture.inserted).toEqual([{ branch_id: "branch-a", opened_by: "staff-a", opening_balance: Number(cash), shift_type: "klinik" }]);
});
it("does not save cash against a stale form branch", async () => {
  fixture.branchId = "branch-b"; await expect(mulaiShiftKlinik(form("150000"))).rejects.toThrow("REDIRECT:/klinik/shift?error="); expect(fixture.inserted).toHaveLength(0);
});
it("does not start a shift with an expired session", async () => {
  fixture.user = null; await expect(mulaiShiftKlinik(form("150000"))).rejects.toThrow("REDIRECT:/klinik/shift?error="); expect(fixture.inserted).toHaveLength(0);
});
