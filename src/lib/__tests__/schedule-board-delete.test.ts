import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../master-guard", () => ({
  assertRole: async () => ({
    from: () => ({
      delete: () => ({
        eq: () => ({
          eq: () => ({
            data: [],
            error: null,
            select: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("../jadwal-scope", () => ({
  scopeJadwal: async () => ({
    cabang: "b",
    awal: "2026-10-01",
    akhir: "2026-10-31",
    employees: ["e"],
    shifts: [],
    existing: { "e|2026-10-02": "s" },
    user: { id: "admin" },
  }),
}));
import { simpanJadwal } from "../../app/(app)/hris/jadwal/actions";
it("a denied/changed board deletion with zero affected rows cannot claim a saved schedule", async () => {
  const f = new FormData();
  f.set("cabang", "b");
  f.set("bulan", "2026-10");
  f.set(
    "rows",
    JSON.stringify([
      { employee_id: "e", tanggal: "2026-10-02", shift_id: "", branch_id: "b" },
    ]),
  );
  await expect(simpanJadwal(f)).rejects.toThrow("error=");
});
