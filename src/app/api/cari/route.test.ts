import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "ADMIN" as string | null,
  rules: [] as { role: string; module_id: string }[],
  policy: [] as { role: string; module_id: string; allowed: string[] }[],
  policyError: null as { code?: string; message?: string } | null,
  tables: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async () => state.policyError ? { data: null, error: state.policyError } : { data: state.policy, error: null },
    from: (table: string) => {
      state.tables.push(table);
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }) }) }) };
      if (table === "role_modules") return { select: async () => ({ data: state.rules }) };
      const rows = table === "employees" ? [{ id: "1", nik: "1", nama: "Budi Rahasia", jabatan: "x", status: "aktif" }] : [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "or", "eq", "is", "ilike", "limit"]) chain[m] = () => chain;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(res);
      return chain;
    },
  }),
}));

import { GET } from "./route";

const search = async () => {
  const res = await GET(new Request("https://vetos.test/api/cari?q=budi"));
  return { status: res.status, body: await res.json() as { data: unknown[] } };
};
const adminRules = () => [{ role: "ADMIN", module_id: "__role_v2__" }, ...["hris", "crm", "pos", "pembelian", "klinik", "pengaturan", "perusahaan", "buku-besar", "kas-bank", "penjualan", "aset-tetap", "pajak", "laporan", "dashboard", "kasir", "quest-staff", "pos-shift"].map(module_id => ({ role: "ADMIN", module_id }))];

beforeEach(() => {
  state.role = "ADMIN"; state.rules = adminRules(); state.policy = []; state.policyError = null; state.tables = [];
});

describe("/api/cari (the middleware skips /api, so this handler is its own sub-menu gate)", () => {
  it("returns employees when the role may open /hris/karyawan", async () => {
    const r = await search();
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
  });
  it("a role restricted away from hris.karyawan gets no employee rows", async () => {
    state.policy = [{ role: "ADMIN", module_id: "hris", allowed: ["hris.absensi"] }];
    const r = await search();
    expect(r.body.data).toEqual([]);
    expect(state.tables).not.toContain("employees");
  });
  it("policy read error + restricted role: fail closed (503, no rows, no data table touched)", async () => {
    state.policyError = { code: "57014", message: "statement timeout" };
    const r = await search();
    expect(r.status).toBe(503);
    expect(r.body.data).toEqual([]);
    expect(state.tables).toEqual(["profiles", "role_modules"]);
  });
  it("42883 raised from inside another function is an error too (fail closed)", async () => {
    state.policyError = { code: "42883", message: "function public.foo(text) does not exist" };
    expect((await search()).status).toBe(503);
  });
  it("policy read error + OWNER: unaffected (OWNER is never restricted)", async () => {
    state.role = "OWNER"; state.rules = [];
    state.policyError = { code: "57014", message: "statement timeout" };
    const r = await search();
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
  });
  it("function not yet in the database (app deployed first) behaves as today", async () => {
    state.policyError = { code: "PGRST202", message: "Could not find the function public.get_my_submenu_policy without parameters in the schema cache" };
    const r = await search();
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
  });
  it("unknown profile (role defaults to STAFF) with a failing policy read is also refused", async () => {
    state.role = null; state.rules = [];
    state.policyError = { message: "fetch failed" };
    expect((await search()).status).toBe(503);
  });
});
