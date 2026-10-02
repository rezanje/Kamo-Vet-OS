import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  cells: ["old"] as string[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
  error: null as { message: string } | null,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("@/lib/master-guard", () => ({
  assertRole: async () => ({
    from: () => ({
      delete: () => {
        state.cells = [];
        const q = {
          eq: () => q,
          select: async () => ({ data: [{ id: "old" }], error: null }),
        };
        return q;
      },
      upsert: async () => ({
        error: { message: "FICTION final write failed" },
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return { data: { jumlah: 2 }, error: state.error };
    },
  }),
}));
vi.mock("@/lib/jadwal-scope", () => ({
  scopeJadwal: async () => ({
    cabang: "b1",
    awal: "2026-10-01",
    akhir: "2026-10-31",
    employees: ["e1"],
    shifts: [{ id: "s1", is_active: true }],
    existing: { "e1|2026-10-01": "s1" },
    existingVersions: {
      "e1|2026-10-01": {
        id: "fresh-server",
        updated_at: "new-server",
        shift_id: "s1",
      },
    },
    user: { id: "admin" },
  }),
}));
import { simpanJadwal } from "../../app/(app)/hris/jadwal/actions";
const expected = {
  id: "old",
  updated_at: "2026-10-01T00:00:00.000001+00:00",
  shift_id: "s1",
};
function form() {
  const f = new FormData();
  f.set("cabang", "b1");
  f.set("bulan", "2026-10");
  f.set(
    "rows",
    JSON.stringify([
      {
        employee_id: "e1",
        tanggal: "2026-10-01",
        shift_id: "",
        branch_id: "b1",
        expected,
      },
      {
        employee_id: "e1",
        tanggal: "2026-10-02",
        shift_id: "s1",
        branch_id: "b1",
        expected: null,
      },
    ]),
  );
  return f;
}
beforeEach(() => {
  state.cells = ["old"];
  state.calls = [];
  state.error = null;
});
it("failed final batch write never commits an earlier board deletion", async () => {
  state.error = { message: "JADWAL: FICTION final write failed" };
  await expect(simpanJadwal(form())).rejects.toThrow("error=");
  expect(state.cells).toEqual(["old"]);
});
it("board forwards original browser snapshot instead of replacing it with current server state", async () => {
  await expect(simpanJadwal(form())).rejects.toThrow("success=2");
  expect(state.calls[0]).toEqual({
    name: "hris_save_schedule_batch",
    args: {
      p_branch: "b1",
      p_start: "2026-10-01",
      p_end: "2026-10-31",
      p_rows: JSON.parse(String(form().get("rows"))),
    },
  });
  expect(state.cells).toEqual(["old"]);
});
