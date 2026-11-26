import { beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  order: { id: "o1", no_opname: "OPO.1", status: "Terbuka", warehouse_id: "wh" } as Record<string, unknown> | null,
  stock: [] as { item_id: string; qty: number }[], stockError: false, throwOn: false, queries: [] as unknown[], writes: 0,
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw Error(u); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "X" }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
  from(table: string) {
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      in: (_c: string, ids: string[]) => { if (table === "stock") s.queries.push(ids); return q; },
      insert: () => { s.writes++; return q; }, update: () => { s.writes++; return q; }, upsert: () => { s.writes++; return q; }, delete: () => { s.writes++; return q; },
      maybeSingle: async () => ({ data: table === "opname_orders" ? s.order : table === "profiles" ? { role: "OWNER" } : null }),
      then: (resolve: (r: unknown) => unknown) => {
        if (s.throwOn && table === "stock") throw new Error("boom");
        return Promise.resolve(table === "stock" ? { data: s.stockError ? null : s.stock, error: s.stockError ? { message: "x" } : null } : { data: [], error: null }).then(resolve);
      },
    };
    return q;
  },
  rpc: async () => { s.writes++; return { data: null, error: null }; },
}) }));
vi.mock("@/lib/akses", () => ({ bolehBukaPath: () => true }));
vi.mock("@/lib/akses-akun", () => ({ aturanEfektif: () => ({}), bacaAkses: async () => ({}) }));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => null }));

import { periksaJumlahTakWajar } from "@/app/(app)/pos/opname/actions";
const A = "10000000-0000-4000-8000-00000000000a", B = "10000000-0000-4000-8000-00000000000b", C = "10000000-0000-4000-8000-00000000000c";

beforeEach(() => { s.order = { id: "o1", no_opname: "OPO.1", status: "Terbuka", warehouse_id: "wh" }; s.stock = []; s.stockError = false; s.throwOn = false; s.queries = []; s.writes = 0; });

it("menandai 1000 vs sistem 1 dan 3000 vs tanpa baris stok; hitungan normal lolos", async () => {
  s.stock = [{ item_id: A, qty: 1 }, { item_id: B, qty: 40 }];
  const r = await periksaJumlahTakWajar("o1", [{ itemId: A, qty: 1000 }, { itemId: B, qty: 38 }, { itemId: C, qty: 3000 }]);
  expect(r).toEqual({ ok: true, janggal: [A, C] });
});

it("TIDAK pernah mengembalikan angka stok sistem ke peramban (layar hitung buta stok)", async () => {
  s.stock = [{ item_id: A, qty: 7.25 }];
  const r = await periksaJumlahTakWajar("o1", [{ itemId: A, qty: 900 }]);
  expect(JSON.stringify(r)).not.toContain("7.25");
  expect(Object.keys(r).sort()).toEqual(["janggal", "ok"]);
});

it("baca saja: tidak menulis apa pun dan tidak memanggil RPC", async () => {
  s.stock = [{ item_id: A, qty: 1 }];
  await periksaJumlahTakWajar("o1", [{ itemId: A, qty: 1000 }]);
  expect(s.writes).toBe(0);
});

it("membaca stok per potongan 200 barang", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  await periksaJumlahTakWajar("o1", ids.map((itemId) => ({ itemId, qty: 1 })));
  expect((s.queries as string[][]).map((q) => q.length)).toEqual([200, 200, 50]);
});

it("menolak isian tidak sah, di luar akses, galat baca stok, dan galat tak terduga (tanpa menebak lolos)", async () => {
  expect(await periksaJumlahTakWajar("o1", [{ itemId: "bukan-uuid", qty: 1 }])).toMatchObject({ ok: false });
  expect(await periksaJumlahTakWajar("o1", [{ itemId: A, qty: -1 }])).toMatchObject({ ok: false });
  expect(await periksaJumlahTakWajar("o1", [{ itemId: A, qty: Number.NaN }])).toMatchObject({ ok: false });
  s.order = null;
  expect(await periksaJumlahTakWajar("o1", [{ itemId: A, qty: 1 }])).toMatchObject({ ok: false, pesan: expect.stringContaining("tidak berhak") });
  s.order = { id: "o1", no_opname: "OPO.1", status: "Terbuka", warehouse_id: "wh" };
  s.stockError = true;
  expect(await periksaJumlahTakWajar("o1", [{ itemId: A, qty: 1 }])).toMatchObject({ ok: false });
  s.stockError = false; s.throwOn = true;
  expect(await periksaJumlahTakWajar("o1", [{ itemId: A, qty: 1 }])).toMatchObject({ ok: false });
});

it("daftar kosong lolos tanpa membaca apa pun", async () => {
  expect(await periksaJumlahTakWajar("o1", [])).toEqual({ ok: true, janggal: [] });
  expect(s.queries).toEqual([]);
});
