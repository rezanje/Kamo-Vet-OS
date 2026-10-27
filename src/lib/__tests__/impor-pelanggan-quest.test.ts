import { beforeEach, expect, it, vi } from "vitest";

// Q01: cards created by the bulk customer import are marked so they never count as "new customers".
const state = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[][], missingColumn: false }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER" } : null, error: null }),
      insert: async (rows: Record<string, unknown>[]) => {
        state.inserts.push(rows);
        if (state.missingColumn && rows.some((r) => "imported_at" in r)) return { error: { message: "Could not find the 'imported_at' column of 'customers'" } };
        return { error: null };
      },
      then: (resolve: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
}) }));
import { imporMaster } from "@/app/(app)/pengaturan/impor/actions";

beforeEach(() => { state.inserts = []; state.missingColumn = false; });
const form = () => {
  const data = new FormData();
  data.set("jenis", "pelanggan");
  data.set("csv", "nama,telp\nBudi,081234567890\n");
  return data;
};

it("marks imported customer cards with imported_at", async () => {
  const outcome = await imporMaster(form()).then(() => "", (e: Error) => e.message);
  expect(outcome).not.toContain("error=");
  expect(state.inserts).toHaveLength(1);
  expect(state.inserts[0][0]).toMatchObject({ name: "Budi" });
  expect(typeof state.inserts[0][0].imported_at).toBe("string");
});

it("still imports before the Q01 database step adds the column", async () => {
  state.missingColumn = true;
  const outcome = await imporMaster(form()).then(() => "", (e: Error) => e.message);
  expect(outcome).not.toContain("error=");
  expect(state.inserts).toHaveLength(2);
  expect(state.inserts[1][0]).not.toHaveProperty("imported_at");
});
