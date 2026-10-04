import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "ADMIN",
  sourceError: null as null | { message: string },
  source: {
    start: "2026-10-01",
    end: "2026-10-31",
    branch_id: "b",
    employees: [],
    assignments: [],
    schedules: [],
    attendance: [],
    leave: [],
    overtime: [],
  },
  rpcReads: 0,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u" } }, error: null }),
    },
    from: (t: string) => {
      const data =
        t === "profiles"
          ? { role: state.role }
          : t === "branches"
            ? [{ id: "b", name: "Fiction branch" }]
            : [{ branch_id: "b", effective_date: "2026-01-01" }];
      const q: Record<string, unknown> = {
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(r),
        maybeSingle: async () => ({ data, error: null }),
      };
      for (const m of ["select", "eq", "order"]) q[m] = () => q;
      return q;
    },
    rpc: async () => {
      state.rpcReads++;
      return { data: state.source, error: state.sourceError };
    },
  }),
}));
import { GET } from "../../app/(app)/laporan/absensi/export/route";
beforeEach(() => {
  state.role = "ADMIN";
  state.sourceError = null;
  state.rpcReads = 0;
});
it("export rejects STAFF before returning sensitive report", async () => {
  state.role = "STAFF";
  await expect(
    GET(
      new Request(
        "http://localhost/laporan/absensi/export?periode=2026-10&cabang=b",
      ),
    ),
  ).rejects.toThrow("error=");
  expect(state.rpcReads).toBe(0);
});
it("foreign branch export fails without collecting other branch sources", async () => {
  const r = await GET(
    new Request(
      "http://localhost/laporan/absensi/export?periode=2026-10&cabang=foreign",
    ),
  );
  expect(r.status).toBe(400);
  expect(await r.text()).toContain("Cabang tidak diizinkan");
  expect(state.rpcReads).toBe(0);
});
it("unreadable source fails without an empty-success spreadsheet", async () => {
  state.sourceError = { message: "HRIS: Riwayat sumber berada di cabang lain" };
  const r = await GET(
    new Request(
      "http://localhost/laporan/absensi/export?periode=2026-10&cabang=b",
    ),
  );
  expect(r.status).toBe(400);
  expect(await r.text()).toContain("Riwayat sumber");
});
it("authorized export is XLSX using the same scoped report source", async () => {
  const r = await GET(
    new Request(
      "http://localhost/laporan/absensi/export?periode=2026-10&cabang=b",
    ),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("Content-Type")).toContain("spreadsheetml");
  expect(new Uint8Array(await r.arrayBuffer()).slice(0, 2)).toEqual(
    new Uint8Array([80, 75]),
  );
});
