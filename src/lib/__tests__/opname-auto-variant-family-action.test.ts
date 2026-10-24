import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  seed: [] as string[],
  members: [] as { family_id: string; item_id: string; items: { item_type: string; is_active: boolean } }[],
  selected: [] as string[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  orderWrites: 0,
  memberReadFails: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(decodeURIComponent(url)); } }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "OPO.00001" }) }));
vi.mock("@/lib/akses", () => ({ bolehBukaPath: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fiction-actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.rpcCalls.push({ name, args });
    return { data: fixture.seed.map(item_id => ({ item_id })), error: null };
  },
  from(table: string) {
    const filters = new Map<string, unknown>();
    let first = 0, last = 499, inserted: unknown = null;
    const rows = () => {
      if (table === "profiles") return [{ role: "OWNER" }];
      if (table === "role_modules") return [];
      if (table === "item_variant_members") return fixture.members
        .filter(row => [...filters].every(([key, values]) => !Array.isArray(values) || values.includes(row[key as "item_id" | "family_id"])))
        .map(row => ({ id: row.item_id, ...row }));
      if (table === "opname_orders") return [{ id: "fiction-order" }];
      return [];
    };
    const result = (single = false) => {
      if (table === "item_variant_members" && fixture.memberReadFails) return { data: null, count: null, error: { message: "read failed" } };
      if (table === "opname_order_items" && inserted) fixture.selected = (inserted as { item_id: string }[]).map(row => row.item_id);
      const all = rows();
      return { data: single ? all[0] ?? null : all.slice(first, last + 1), count: all.length, error: null };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.set(key, value); return query; },
      in: (key: string, values: unknown[]) => { filters.set(key, values); return query; },
      order: () => query,
      range: (from: number, to: number) => { first = from; last = to; return query; },
      insert: (value: unknown) => { if (table === "opname_orders") fixture.orderWrites++; inserted = value; return query; },
      single: async () => result(true),
      maybeSingle: async () => result(true),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));

import { buatPerintah } from "@/app/(app)/pos/opname/actions";

const form = () => {
  const data = new FormData();
  data.set("warehouse_id", "fiction-warehouse");
  data.set("penanggung_jawab", "Fiction Counter");
  data.set("lingkup_mode", "auto");
  return data;
};

beforeEach(() => {
  fixture.seed = Array.from({ length: 30 }, (_, i) => `seed-${i}`);
  fixture.members = [
    { family_id: "family-a", item_id: "seed-0", items: { item_type: "Persediaan", is_active: true } },
    { family_id: "family-a", item_id: "seed-1", items: { item_type: "Persediaan", is_active: true } },
    { family_id: "family-a", item_id: "zero-stock", items: { item_type: "Persediaan", is_active: true } },
    { family_id: "family-a", item_id: "other-variant", items: { item_type: "Persediaan", is_active: true } },
    { family_id: "family-a", item_id: "inactive", items: { item_type: "Persediaan", is_active: false } },
    { family_id: "family-a", item_id: "service", items: { item_type: "Jasa", is_active: true } },
    { family_id: "unrelated-family", item_id: "unrelated", items: { item_type: "Persediaan", is_active: true } },
  ];
  fixture.selected = [];
  fixture.rpcCalls = [];
  fixture.orderWrites = 0;
  fixture.memberReadFails = false;
});

it("adds all eligible variants including zero stock after the 30 seed SKUs without unrelated families or duplicates", async () => {
  await expect(buatPerintah(form())).rejects.toThrow("/pos/opname/fiction-order");
  expect(fixture.rpcCalls[0]).toEqual({ name: "opname_daftar_hitung", args: { p_warehouse: "fiction-warehouse", p_top: 20, p_acak: 10 } });
  expect(fixture.selected).toHaveLength(32);
  expect(fixture.selected).toEqual(expect.arrayContaining([...fixture.seed, "zero-stock", "other-variant"]));
  expect(new Set(fixture.selected).size).toBe(32);
  expect(fixture.selected).not.toEqual(expect.arrayContaining(["unrelated", "inactive", "service"]));
});

it("does not create an incomplete auto order when variant family lookup fails", async () => {
  fixture.memberReadFails = true;
  await expect(buatPerintah(form())).rejects.toThrow("daftar varian");
  expect(fixture.orderWrites).toBe(0);
  expect(fixture.selected).toEqual([]);
});
