import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "STAFF",
  user: "u" as string | null,
  error: null as null | { code: string; message: string },
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
      if (table !== "profiles")
        throw new Error("Use RPC for schedule mutations");
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
import { ajukanPerubahanJadwal } from "../../app/me/jadwal/actions";
import {
  setujuiPerubahanJadwal,
  tolakPerubahanJadwal,
} from "../../app/(app)/hris/pengajuan/jadwal/actions";
const form = () => {
  const f = new FormData();
  Object.entries({
    schedule_id: "s",
    updated_at: "2026-10-01T01:00:00.123456Z",
    shift_id: "new",
    branch_id: "b",
    reason: "Alasan perubahan",
    employee_id: "forged",
    status: "Disetujui",
  }).forEach(([k, v]) => f.set(k, v));
  return f;
};
beforeEach(() => {
  state.role = "STAFF";
  state.user = "u";
  state.error = null;
  state.calls = [];
});
it("staff submission ignores forged employee and approval fields, preserves raw snapshot version", async () => {
  await expect(ajukanPerubahanJadwal(form())).rejects.toThrow("success=");
  expect(state.calls).toEqual([
    {
      name: "hris_request_schedule_change",
      args: {
        p_schedule_id: "s",
        p_expected_updated_at: "2026-10-01T01:00:00.123456Z",
        p_shift_id: "new",
        p_branch_id: "b",
        p_reason: "Alasan perubahan",
      },
    },
  ]);
});
it("unauthenticated submission cannot call the RPC", async () => {
  state.user = null;
  await expect(ajukanPerubahanJadwal(form())).rejects.toThrow("/login");
  expect(state.calls).toEqual([]);
});
it("staff cannot approve even through an HR server action", async () => {
  await expect(setujuiPerubahanJadwal(form())).rejects.toThrow("error=");
  expect(state.calls).toEqual([]);
});
it("HR rejection uses its own false decision despite forged approval fields", async () => {
  state.role = "ADMIN";
  const f = form();
  f.set("id", "r");
  f.set("approve", "true");
  await expect(tolakPerubahanJadwal(f)).rejects.toThrow("success=");
  expect(state.calls).toEqual([
    {
      name: "hris_decide_schedule_change",
      args: {
        p_request_id: "r",
        p_approve: false,
        p_reason: "Alasan perubahan",
      },
    },
  ]);
});
it("a stale backend rejection is shown as failure rather than success", async () => {
  state.error = {
    code: "P0001",
    message: "JADWAL: Jadwal berubah. Muat ulang",
  };
  await expect(ajukanPerubahanJadwal(form())).rejects.toThrow(
    "error=Jadwal+berubah",
  );
});
