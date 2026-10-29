import { beforeEach, expect, it, vi } from "vitest";

// I02: the adjustment screen posts through one atomic RPC; it never writes stock,
// documents or journals step by step from the app.
const db = vi.hoisted(() => ({
  role: "OWNER",
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  writes: [] as string[],
  result: { data: { adjustment_id: "adj-1", no_adj: "PS.2026.10.00001" } as unknown, error: null as { message: string } | null },
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fixture-user" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => { db.rpcs.push({ name, args }); return db.result; },
  from(table: string) {
    const row = table === "profiles" ? { role: db.role } : table === "accounting_locks" ? { closed_until: null } : null;
    const query = {
      select: () => query, eq: () => query, in: () => query,
      insert: () => { db.writes.push(`${table}:insert`); return query; },
      update: () => { db.writes.push(`${table}:update`); return query; },
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return query;
  },
}) }));
import { simpanPenyesuaian } from "@/app/(app)/pos/penyesuaian/actions";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ warehouse_id: "wh-1", tanggal: "2026-10-30", alasan: "rusak", keterangan: "kemasan sobek",
    baris: JSON.stringify([{ item_id: "item-a", qty_baru: 3 }, { item_id: "item-b", qty_baru: -1 }]), request_key: "req-1", ...fields })) data.set(key, value);
  return data;
}

beforeEach(() => {
  db.role = "OWNER"; db.rpcs = []; db.writes = [];
  db.result = { data: { adjustment_id: "adj-1", no_adj: "PS.2026.10.00001" }, error: null };
});

it("posts the whole adjustment through the atomic RPC with the form's request key", async () => {
  await expect(simpanPenyesuaian(form({}))).rejects.toThrow("REDIRECT:/pos/penyesuaian/adj-1?success=");
  expect(db.rpcs).toEqual([{ name: "post_inventory_adjustment_atomic", args: {
    p_request_key: "req-1", p_warehouse_id: "wh-1", p_tanggal: "2026-10-30", p_alasan: "rusak", p_keterangan: "kemasan sobek",
    p_rows: [{ item_id: "item-a", qty_baru: 3 }],
  } }]);
  expect(db.writes).toEqual([]);
});

it("shows the database refusal and does not claim success", async () => {
  db.result = { data: null, error: { message: "Akun persediaan 1301 / selisih 5902 belum tersedia atau tidak aktif. Penyesuaian tidak diposting." } };
  await expect(simpanPenyesuaian(form({}))).rejects.toThrow(/REDIRECT:\/pos\/penyesuaian\/baru\?wh=wh-1&error=.*5902/);
});

it("requires a request key and an authorised role before calling the database", async () => {
  await expect(simpanPenyesuaian(form({ request_key: "" }))).rejects.toThrow("REDIRECT:/pos/penyesuaian/baru?wh=wh-1&error=");
  db.role = "STAFF";
  await expect(simpanPenyesuaian(form({}))).rejects.toThrow("REDIRECT:/pos/penyesuaian/baru?wh=wh-1&error=");
  expect(db.rpcs).toEqual([]);
});
