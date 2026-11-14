// E3 (meeting 12 Nov 2026): middleware menegakkan akses khusus akun (server-side, ketik URL langsung).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  profile: { role: "STAFF", is_active: true } as { role: string; is_active?: boolean },
  rules: [] as { role: string; module_id: string }[],
  override: null as unknown,
  overrideError: null as { code?: string; message: string } | null,
  rpcCalls: [] as string[],
  reads: [] as string[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "akun-staf-online" } }, error: null }) },
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
      if (name === "get_my_access_override") return state.overrideError ? { data: null, error: state.overrideError } : { data: state.override, error: null };
      return { data: [], error: null };
    },
    from: (table: string) => {
      state.reads.push(table);
      if (table === "role_capabilities") {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }) };
        return chain;
      }
      if (["branches", "cashier_shifts", "user_branches"].includes(table)) {
        const result = table === "branches" ? { data: { id: "eb200000-0000-4000-8000-000000000001", is_active: true, type: "BOTH" } }
          : table === "cashier_shifts" ? { data: null } : { data: [{ branch_id: "eb200000-0000-4000-8000-000000000001" }] };
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result, then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) };
        return chain;
      }
      return {
        select: () => table === "profiles"
          ? { eq: () => ({ maybeSingle: async () => ({ data: state.profile, error: null }) }) }
          : Promise.resolve({ data: state.rules, error: null }),
      };
    },
  }),
}));

import { updateSession } from "../supabase/middleware";

const go = (path: string) => updateSession(new NextRequest("https://vetos.test" + path));
const lolos = async (path: string) => (await go(path)).headers.get("x-middleware-next") === "1";
const tujuan = async (path: string) => { const r = await go(path); return r.headers.get("location") ? new URL(r.headers.get("location")!).pathname : null; };

beforeEach(() => {
  state.profile = { role: "STAFF", is_active: true };
  state.rules = [];
  state.override = { mode: "khusus", modules: { penjualan: ["penjualan.online"] } };
  state.overrideError = null;
  state.rpcCalls = [];
  state.reads = [];
});

describe("STAFF dengan 'Hanya akses khusus' Penjualan Online", () => {
  it("membaca akses khusus sekali per navigasi, bersamaan dengan profil, aturan, dan sub-menu", async () => {
    await go("/penjualan/online");
    expect(state.reads).toEqual(["profiles", "role_modules"]);
    expect(state.rpcCalls).toEqual(["get_my_submenu_policy", "get_my_access_override"]);
  });
  it.each(["/penjualan/online", "/penjualan/online/impor", "/penjualan/online/baru", "/me", "/mulai"])("membuka %s", async (path) => {
    expect(await lolos(path)).toBe(true);
  });
  it.each(["/klinik", "/klinik/antrian", "/kasir", "/penjualan", "/penjualan/faktur", "/crm", "/", "/laporan"])("%s diblokir ke /mulai (termasuk klinik bawaan STAFF)", async (path) => {
    expect(await tujuan(path)).toBe("/mulai");
  });
});

describe("Peran + tambahan", () => {
  it("STAFF tetap membuka Klinik (peran) dan Penjualan Online (tambahan), sub-menu lain tetap tertutup", async () => {
    state.override = { mode: "tambah", modules: { penjualan: ["penjualan.online"] } };
    expect(await lolos("/penjualan/online")).toBe(true);
    // Kasir lolos hak buka; berikutnya hanya diminta memilih cabang operasional (bukan diblokir ke /mulai)
    expect(await tujuan("/kasir")).toBe("/mulai/cabang");
    expect(await tujuan("/penjualan/faktur")).toBe("/mulai");
  });
});

describe("gagal baca / fungsi belum ada = ikuti peran (tidak pernah memperluas)", () => {
  it.each([
    ["galat database", { code: "57014", message: "statement timeout" }],
    ["fungsi belum ada (aplikasi rilis lebih dulu)", { code: "PGRST202", message: "Could not find the function public.get_my_access_override without parameters in the schema cache" }],
  ])("%s: STAFF kembali ke akses perannya", async (_name, error) => {
    state.overrideError = error;
    expect(await tujuan("/penjualan/online")).toBe("/mulai");
    expect(await tujuan("/crm")).toBe("/mulai");
  });
  it("bentuk jawaban tidak dikenal: ikuti peran", async () => {
    state.override = [{ role: "STAFF" }];
    expect(await tujuan("/penjualan/online")).toBe("/mulai");
  });
  it("galat akses khusus tidak mengunci akun ke halaman login (beda dengan galat sub-menu)", async () => {
    state.overrideError = { code: "57014", message: "statement timeout" };
    expect(await tujuan("/me")).toBeNull();
  });
});

describe("OWNER dan peran lain", () => {
  it("OWNER dengan baris akses khusus (mis. peran diubah belakangan) tetap penuh", async () => {
    state.profile = { role: "OWNER", is_active: true };
    expect(await lolos("/keuangan/jurnal")).toBe(true);
    expect(await lolos("/crm")).toBe(true);
  });
  it("tanpa akses khusus (null) perilaku lama persis: STAFF bawaan tidak membuka Penjualan", async () => {
    state.override = null;
    expect(await tujuan("/penjualan/online")).toBe("/mulai");
  });
});
