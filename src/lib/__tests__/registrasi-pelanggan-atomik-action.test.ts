import { beforeEach, expect, it, vi } from "vitest";

// Temuan harness PR #328 (C3b): registrasi live dan impor berbarengan membuat pemilik ganda.
// Registrasi sekarang mencari-atau-membuat pemilik lewat SATU RPC atomik yang memakai kunci
// identitas yang sama dengan impor. Tes ini menjalankan server action ASLI dengan
// infrastruktur (Supabase, header, redirect) diganti; perilaku database diuji terpisah di
// scripts/test-impor-rekam-medis-postgres.py.
const s = vi.hoisted(() => ({
  rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; value: Record<string, unknown> }>,
  pick: { customer_id: "pemilik-ada", dibuat: false } as Record<string, unknown> | null,
  rpcError: "" as string,
  pickByPhone: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT:${url}`), { url }); } }));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: "cabang" }) }));
vi.mock("@/lib/dokter", () => ({ resolveDokter: async () => ({ doctorId: null, nama: null }) }));
vi.mock("@/lib/anabul", async (original) => ({
  ...(await original<typeof import("@/lib/anabul")>()),
  cariAnabulSenama: async () => null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "staf" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.rpc.push({ name, args });
      if (name === "customer_pick_by_phone") return { data: s.pickByPhone, error: null };
      if (name === "registrasi_pelanggan_atomik") {
        return s.rpcError ? { data: null, error: { message: s.rpcError } } : { data: s.pick, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain, eq: chain, gte: chain, lt: chain, in: chain, order: chain, limit: chain,
        maybeSingle: async () => ({
          data: table === "branches" ? { code: "TST" } : table === "customers" ? { id: "pemilik-ada", name: "Pemilik Fiktif" } : null,
          error: null,
        }),
        single: async () => ({ data: { id: `${table}-baru` }, error: null }),
        insert: (value: Record<string, unknown>) => { s.inserts.push({ table, value }); return q; },
        update: chain, delete: chain,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      });
      return q;
    },
  }),
}));

import { lookupPetsByPhone, registrasiPasien } from "@/app/(app)/klinik/registrasi/actions";

function form(phone = "+62 812-3456-7890") {
  const data = new FormData();
  data.set("phone", phone);
  data.set("name", "Pemilik Fiktif");
  data.set("branchId", "cabang");
  data.set("pets", JSON.stringify([{ name: "Kucing Fiktif", species: "Kucing" }]));
  return data;
}

async function jalankan(data: FormData) {
  try {
    await registrasiPasien(data);
    return "tanpa redirect";
  } catch (error) {
    return decodeURIComponent((error as { url?: string }).url ?? String(error));
  }
}

beforeEach(() => {
  s.rpc = [];
  s.inserts = [];
  s.pick = { customer_id: "pemilik-ada", dibuat: false };
  s.rpcError = "";
  s.pickByPhone = null;
});

it("mencari-atau-membuat pemilik lewat satu RPC atomik, bukan cari lalu insert terpisah", async () => {
  expect(await jalankan(form())).toContain("/klinik/antrian?success=1");
  expect(s.rpc[0]).toMatchObject({ name: "registrasi_pelanggan_atomik", args: { p_phone: "+62 812-3456-7890", p_name: "Pemilik Fiktif" } });
  expect(s.inserts.filter((item) => item.table === "customers")).toEqual([]);
});

it("kunjungan memakai pemilik yang dikembalikan RPC", async () => {
  await jalankan(form());
  expect(s.inserts.find((item) => item.table === "visits")?.value).toMatchObject({ customer_id: "pemilik-ada" });
  expect(s.inserts.find((item) => item.table === "pets")?.value).toMatchObject({ customer_id: "pemilik-ada" });
});

it("nomor HP yang terdaftar pada beberapa pelanggan ditolak, tidak dipilih otomatis", async () => {
  s.rpcError = "Nomor HP ini terdaftar pada beberapa pelanggan. Minta admin memeriksa data pelanggan; sistem tidak memilih salah satu secara otomatis.";
  const hasil = await jalankan(form());
  expect(hasil).toContain("/klinik/registrasi?error=");
  expect(hasil).toContain("beberapa pelanggan");
  expect(s.inserts).toEqual([]);
});

it("HP tidak valid tetap ditolak sebelum menyentuh database", async () => {
  expect(await jalankan(form("0"))).toContain("/klinik/registrasi?error=");
  expect(s.rpc).toEqual([]);
});

it("isian otomatis memakai kunci HP kanonik yang sama dengan penyimpanan", async () => {
  s.pickByPhone = { status: "one", customer_id: "pemilik-ada" };
  const hasil = await lookupPetsByPhone("+62 812-3456-7890");
  expect(s.rpc[0]).toMatchObject({ name: "customer_pick_by_phone", args: { p_phone: "+62 812-3456-7890" } });
  expect(hasil.customer).toMatchObject({ id: "pemilik-ada" });
});

it("isian otomatis tidak memilih bila satu HP dipakai beberapa pelanggan", async () => {
  s.pickByPhone = { status: "ambiguous", count: 2 };
  expect(await lookupPetsByPhone("0812-3456-7890")).toEqual({ customer: null, pets: [] });
});
