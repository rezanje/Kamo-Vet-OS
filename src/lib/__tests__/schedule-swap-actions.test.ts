import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "STAFF",
  user: "staff" as string | null,
  error: null as null | { message: string; code: string },
  calls: [] as { name: string; args: unknown }[],
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user ? { id: state.user } : null },
      }),
    },
    from: (table: string) => {
      if (table !== "profiles") throw new Error("Mutations must use RPC");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { role: state.role },
              error: null,
            }),
          }),
        }),
      };
    },
    rpc: async (name: string, args: unknown) => {
      state.calls.push({ name, args });
      return { error: state.error };
    },
  }),
}));
import {
  ajukanTukarShift,
  terimaTukarShift,
  tolakTukarShift,
  batalkanTukarShift,
} from "../../app/me/jadwal/tukar/actions";
import {
  setujuiTukarShift,
  tolakTukarShiftHR,
} from "../../app/(app)/hris/pengajuan/tukar/actions";
const form = () => {
  const f = new FormData();
  Object.entries({
    id: "request",
    own_id: "own",
    own_version: "2026-10-02T01:00:00.123456Z",
    peer_id: "peer",
    peer_version: "2026-10-02T01:00:00.654321Z",
    branch_id: "branch",
    reason: "Alasan tukar",
    employee_id: "forged",
    status: "Disetujui",
    approve: "true",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
};
beforeEach(() => {
  state.role = "STAFF";
  state.user = "staff";
  state.error = null;
  state.calls = [];
});
it("swap submission cannot forge employee or bypass peer consent and preserves both versions", async () => {
  await expect(ajukanTukarShift(form())).rejects.toThrow("success=");
  expect(state.calls).toEqual([
    {
      name: "hris_request_schedule_swap",
      args: {
        p_own_id: "own",
        p_own_version: "2026-10-02T01:00:00.123456Z",
        p_peer_id: "peer",
        p_peer_version: "2026-10-02T01:00:00.654321Z",
        p_branch_id: "branch",
        p_reason: "Alasan tukar",
      },
    },
  ]);
});
it("anonymous request cannot reach the mutation", async () => {
  state.user = null;
  await expect(ajukanTukarShift(form())).rejects.toThrow("/login");
  expect(state.calls).toEqual([]);
});
it("peer response rejection cannot be changed by a forged approve value", async () => {
  await expect(tolakTukarShift(form())).rejects.toThrow("success=");
  expect(state.calls).toEqual([
    {
      name: "hris_respond_schedule_swap",
      args: { p_id: "request", p_accept: false, p_reason: "Alasan tukar" },
    },
  ]);
});
it("acceptance and cancellation use separate server-owned operations", async () => {
  await expect(terimaTukarShift(form())).rejects.toThrow("success=");
  await expect(batalkanTukarShift(form())).rejects.toThrow("success=");
  expect(state.calls.map((r) => [r.name, r.args])).toEqual([
    [
      "hris_respond_schedule_swap",
      { p_id: "request", p_accept: true, p_reason: "Alasan tukar" },
    ],
    [
      "hris_cancel_schedule_swap",
      { p_id: "request", p_reason: "Alasan tukar" },
    ],
  ]);
});
it("STAFF cannot use HR approval server action", async () => {
  await expect(setujuiTukarShift(form())).rejects.toThrow("error=");
  expect(state.calls).toEqual([]);
});
it("authorized HR rejection stays false and database stale failure is surfaced", async () => {
  state.role = "ADMIN";
  state.error = { code: "P0001", message: "JADWAL: Salah satu jadwal berubah" };
  await expect(tolakTukarShiftHR(form())).rejects.toThrow("error=Salah");
  expect(state.calls).toEqual([
    {
      name: "hris_decide_schedule_swap",
      args: { p_id: "request", p_approve: false, p_reason: "Alasan tukar" },
    },
  ]);
});
