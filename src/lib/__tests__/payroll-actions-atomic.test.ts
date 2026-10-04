import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "OWNER",
  calls: [] as { name: string; args: Record<string, unknown> }[],
  writes: [] as string[],
  error: null as null | { code: string; message: string },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
vi.mock("../supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return {
        data:
          name === "hris_assert_payroll_scope"
            ? true
            : { revision: 3, version: 1 },
        error: name === "hris_finalize_payroll" ? state.error : null,
      };
    },
    from: (t: string) => {
      const rows: Record<string, unknown>[] =
        t === "payrolls"
          ? [
              {
                id: "p1",
                employee_id: "e1",
                periode: "2026-10",
                status: "draft",
                total: 50,
                cicilan_kasbon: 0,
                reimburse: 0,
              },
            ]
          : t === "employees"
            ? [{ id: "e1", status: "Aktif", nama: "Fiction", gaji_pokok: 50 }]
            : t === "payroll_settings"
              ? [
                  {
                    id: true,
                    telat_mulai_menit: 1,
                    telat_blok_menit: 5,
                    telat_nominal_per_blok: 0,
                    telat_maks: 0,
                    bolos_per_hari: 0,
                    lembur_per_jam: 0,
                  },
                ]
              : t === "coa_accounts"
                ? [{ id: "coa", code: "1102" }]
                : [];
      const q: Record<string, unknown> = {
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, count: rows.length, error: null }).then(
            r,
          ),
        maybeSingle: async () => ({
          data:
            t === "profiles"
              ? { role: state.role }
              : t === "accounting_locks"
                ? { closed_until: null }
                : null,
          error: null,
        }),
        single: async () => ({ data: { id: "fiction" }, error: null }),
      };
      for (const m of [
        "select",
        "eq",
        "gte",
        "lte",
        "lt",
        "order",
        "range",
        "in",
        "not",
        "is",
        "neq",
        "limit",
        "like",
      ])
        q[m] = () => q;
      for (const m of ["insert", "update", "upsert", "delete"])
        q[m] = () => {
          state.writes.push(t + ":" + m);
          return q;
        };
      return q;
    },
  }),
}));
import { sahkanPenggajian } from "../../app/(app)/hris/penggajian/actions";
const form = () => {
  const f = new FormData();
  f.set("periode", "2026-10");
  f.set("version", "1");
  f.set("catatan", "Pengesahan fiksi setelah pemeriksaan");
  f.set("account_id", "fiction-bank");
  return f;
};
beforeEach(() => {
  state.role = "OWNER";
  state.calls = [];
  state.writes = [];
  state.error = null;
});
it("journal rejection calls one atomic settlement and performs no partial client writes", async () => {
  state.error = { code: "P0001", message: "HRIS: Akun jurnal tidak tersedia" };
  await expect(sahkanPenggajian(form())).rejects.toThrow("error=");
  expect(state.writes).toEqual([]);
  expect(state.calls).toEqual([
    {
      name: "hris_finalize_payroll",
      args: {
        p_period: "2026-10",
        p_version: 1,
        p_account: "fiction-bank",
        p_reason: "Pengesahan fiksi setelah pemeriksaan",
      },
    },
  ]);
});
it("stale draft failure cannot report final success", async () => {
  state.error = {
    code: "P0001",
    message: "HRIS: Draft tidak tersedia/berubah atau sudah final",
  };
  await expect(sahkanPenggajian(form())).rejects.toThrow("error=Draft");
  expect(state.writes).toEqual([]);
});
it("branch HR cannot finalize the entire company", async () => {
  state.role = "ADMIN";
  await expect(sahkanPenggajian(form())).rejects.toThrow("error=");
  expect(state.calls).toEqual([]);
  expect(state.writes).toEqual([]);
});
