import { beforeEach, expect, it, vi } from "vitest";

// Q01: cards created by the bulk customer import are marked so they never count as "new customers".
// Master pasien (±10 ribu kartu): nomor terdaftar dibaca lengkap melewati batas 1.000 baris API,
// dan simpanan dipotong supaya tiap kiriman kecil.
const state = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[][],
  missingColumn: false,
  failInsertAt: -1,
  customers: [] as { id: string; phone: string }[],
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
        if (state.inserts.length - 1 === state.failInsertAt) return { error: { message: "canceling statement due to statement timeout" } };
        if (state.missingColumn && rows.some((r) => "imported_at" in r)) return { error: { message: "Could not find the 'imported_at' column of 'customers'" } };
        return { error: null };
      },
      then: (resolve: (x: unknown) => unknown) => {
        if (table !== "customers") return Promise.resolve({ data: [], error: null }).then(resolve);
        // Seperti PostgREST: tanpa range dipotong di 1.000 baris.
        const [from, to] = range ?? [0, 999];
        const data = state.customers.slice(from, Math.min(to + 1, from + 1000));
        return Promise.resolve({ data, count: state.customers.length, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));
import { imporMaster } from "@/app/(app)/pengaturan/impor/actions";

beforeEach(() => { state.inserts = []; state.missingColumn = false; state.failInsertAt = -1; state.customers = []; });
const form = (csv = "nama,telp\nBudi,081234567890\n") => {
  const data = new FormData();
  data.set("jenis", "pelanggan");
  data.set("csv", csv);
  return data;
};
const hasil = (data: FormData) => imporMaster(data).then(() => "", (e: Error) => decodeURIComponent(e.message));
const telp = (i: number) => `0812${String(i).padStart(8, "0")}`;

it("marks imported customer cards with imported_at", async () => {
  const outcome = await hasil(form());
  expect(outcome).not.toContain("error=");
  expect(state.inserts).toHaveLength(1);
  expect(state.inserts[0][0]).toMatchObject({ name: "Budi" });
  expect(typeof state.inserts[0][0].imported_at).toBe("string");
});

it("still imports before the Q01 database step adds the column", async () => {
  state.missingColumn = true;
  const outcome = await hasil(form());
  expect(outcome).not.toContain("error=");
  expect(state.inserts).toHaveLength(2);
  expect(state.inserts[1][0]).not.toHaveProperty("imported_at");
});

it("skips phones already registered beyond the first 1.000 customers", async () => {
  state.customers = Array.from({ length: 1500 }, (_, i) => ({ id: `c${String(i).padStart(5, "0")}`, phone: telp(i) }));
  const outcome = await hasil(form(`nama,telp\nLama,${telp(1400)}\nBaru,${telp(9999)}\n`));
  expect(outcome).toContain("1 pelanggan diimpor, 1 baris dilewati");
  expect(state.inserts.flat().map((r) => r.name)).toEqual(["Baru"]);
});

it("saves a large file in chunks of 500", async () => {
  const csv = ["nama,telp", ...Array.from({ length: 1200 }, (_, i) => `P${i},${telp(i)}`)].join("\n");
  const outcome = await hasil(form(csv));
  expect(outcome).toContain("1200 pelanggan berhasil diimpor");
  expect(state.inserts.map((rows) => rows.length)).toEqual([500, 500, 200]);
});

it("reports how many rows landed when a later chunk fails", async () => {
  state.failInsertAt = 1;
  const csv = ["nama,telp", ...Array.from({ length: 1200 }, (_, i) => `P${i},${telp(i)}`)].join("\n");
  const outcome = await hasil(form(csv));
  expect(outcome).toContain("error=");
  expect(outcome).toContain("500 pelanggan sudah masuk, 700 belum");
});
