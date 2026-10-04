import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  calls: [] as { name: string; args: unknown }[],
  error: null as null | { message: string; code?: string },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "staff" } } }) },
    from: () => {
      throw new Error("Direct attendance table access forbidden");
    },
    rpc: async (name: string, args: unknown) => {
      state.calls.push({ name, args });
      return { data: { id: "one-session" }, error: state.error };
    },
  }),
}));
import { clockIn, clockOut } from "../../app/me/actions";
beforeEach(() => {
  state.calls = [];
  state.error = null;
});
it.each([
  ["in", clockIn],
  ["out", clockOut],
] as const)(
  "uses atomic backend clock for %s ignoring forged employee/time",
  async (action, run) => {
    const f = new FormData();
    f.set("branch_id", "branch");
    f.set("employee_id", "other");
    f.set("checked_in_at", "2099-01-01");
    f.set("lat", "-6");
    f.set("lng", "106");
    await expect(run(f)).rejects.toThrow(`success=${action}`);
    expect(state.calls).toEqual([
      {
        name: "hris_clock_attendance",
        args: {
          p_action: action,
          p_branch_id: "branch",
          p_lat: -6,
          p_lng: 106,
        },
      },
    ]);
  },
);
it("reports failed SQL write without claiming successful checkout", async () => {
  state.error = { message: "ATTENDANCE: Sesi lama. Minta koreksi HR" };
  const f = new FormData();
  f.set("branch_id", "branch");
  await expect(clockOut(f)).rejects.toThrow("error=");
});
