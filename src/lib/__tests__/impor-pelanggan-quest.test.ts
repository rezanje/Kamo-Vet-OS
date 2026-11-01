import { beforeEach, expect, it, vi } from "vitest";

// Q01: cards created by the bulk customer import are marked so they never count as "new customers".
// Juga: file besar disimpan bertahap (bukan satu INSERT raksasa yang kena statement timeout) dan
// cek nomor kembar membaca SEMUA pelanggan, bukan cuma 1000 baris pertama PostgREST.
const state = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[][],
  missingColumn: false,
  /** baris tabel yang dibaca lewat select (dipotong per range seperti PostgREST) */
  rows: {} as Record<string, Record<string, unknown>[]>,
  /** insert ke-n (mulai 1) yang dibuat gagal */
  failInsertAt: 0,
  /** baris maksimal per respons, meniru max-rows Supabase */
  maxRows: 1000,
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    let range: [number, number] | null = null;
    const q = {
      select: () => q, eq: () => q, order: () => q,
      range: (from: number, to: number) => { range = [from, to]; return q; },
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER" } : null, error: null }),
      insert: async (rows: Record<string, unknown>[]) => {
        state.inserts.push(rows);
        if (state.failInsertAt === state.inserts.length) return { error: { message: "canceling statement due to statement timeout" } };
        if (state.missingColumn && rows.some((r) => "imported_at" in r)) return { error: { message: "Could not find the 'imported_at' column of 'customers'" } };
        return { error: null };
      },
      then: (resolve: (x: unknown) => unknown) => {
        const all = state.rows[table] ?? [];
        const [from, to] = range ?? [0, all.length - 1];
        const data = all.slice(from, Math.min(to + 1, from + state.maxRows));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));
import { imporMaster } from "@/app/(app)/pengaturan/impor/actions";

beforeEach(() => { state.inserts = []; state.missingColumn = false; state.rows = {}; state.failInsertAt = 0; });
const form = (csv = "nama,telp\nBudi,081234567890\n") => {
  const data = new FormData();
  data.set("jenis", "pelanggan");
  data.set("csv", csv);
  return data;
};
const jalankan = (data: FormData) => imporMaster(data).then(() => "", (e: Error) => decodeURIComponent(e.message));
const telp = (i: number) => `0812${String(i).padStart(8, "0")}`;
const csvBanyak = (n: number) => ["nama,telp", ...Array.from({ length: n }, (_, i) => `Pelanggan ${i},${telp(i)}`)].join("\n");

it("marks imported customer cards with imported_at", async () => {
  const outcome = await jalankan(form());
  expect(outcome).not.toContain("error=");
  expect(state.inserts).toHaveLength(1);
  expect(state.inserts[0][0]).toMatchObject({ name: "Budi" });
  expect(typeof state.inserts[0][0].imported_at).toBe("string");
});

it("still imports before the Q01 database step adds the column", async () => {
  state.missingColumn = true;
  const outcome = await jalankan(form());
  expect(outcome).not.toContain("error=");
  expect(state.inserts).toHaveLength(2);
  expect(state.inserts[1][0]).not.toHaveProperty("imported_at");
});

it("menyimpan file besar bertahap per 500 baris", async () => {
  const outcome = await jalankan(form(csvBanyak(1201)));
  expect(outcome).toContain("success=1201 pelanggan berhasil diimpor");
  expect(state.inserts.map((r) => r.length)).toEqual([500, 500, 201]);
  expect(state.inserts.every((r) => typeof r[0].imported_at === "string")).toBe(true);
});

it("tanpa kolom Q01, potongan berikutnya langsung tanpa penanda", async () => {
  state.missingColumn = true;
  const outcome = await jalankan(form(csvBanyak(600)));
  expect(outcome).toContain("success=600 pelanggan");
  expect(state.inserts.map((r) => [r.length, "imported_at" in r[0]])).toEqual([[500, true], [500, false], [100, false]]);
});

it("nomor yang sudah terdaftar di luar 1000 baris pertama tetap terdeteksi kembar", async () => {
  state.rows.customers = Array.from({ length: 2500 }, (_, i) => ({ phone: `+62 812-${String(i + 100000).padStart(8, "0")}` }));
  // baris ke-2400 di database = nomor yang sama dengan Budi di file
  state.rows.customers[2400] = { phone: "+62 812-3456-7890" };
  const outcome = await jalankan(form("nama,telp\nBudi,081234567890\nSari,081299990000\n"));
  expect(outcome).toContain("1 pelanggan diimpor, 1 baris dilewati");
  expect(state.inserts.flat().map((r) => r.name)).toEqual(["Sari"]);
});

it("gagal di tengah: pesan menyebut yang sudah tersimpan, tanpa error database mentah", async () => {
  state.failInsertAt = 3;
  const outcome = await jalankan(form(csvBanyak(1300)));
  expect(outcome).toContain("error=1000 baris sudah tersimpan");
  expect(outcome).toContain("Unggah ulang file yang sama aman");
  expect(outcome).not.toContain("canceling statement");
});
