import { beforeEach, expect, it, vi } from "vitest";

// Golongan di data pelanggan: kosong = ikut benefit level, dipilih = golongan khusus (menang).
const db = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[], role: "ADMIN" }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "a0000000-0000-4000-8000-000000000001" } } }) },
  from: (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: db.role } : { id: "g-reseller" }, error: null }),
      update: (values: Record<string, unknown>) => { db.updates.push(values); return { eq: async () => ({ error: null }) }; },
    };
    return q;
  },
}) }));
import { updateKategoriPelanggan } from "@/app/(app)/crm/pelanggan/actions";

const form = (category: string) => { const f = new FormData(); f.set("id", "c1"); f.set("category_id", category); return f; };
beforeEach(() => { db.updates = []; db.role = "ADMIN"; });

it("a chosen golongan is saved as a manual golongan that wins over the level benefit", async () => {
  await updateKategoriPelanggan(form("g-reseller"));
  expect(db.updates).toEqual([{ category_id: "g-reseller", category_manual: true }]);
});

it("an empty choice returns the customer to the level benefit", async () => {
  await updateKategoriPelanggan(form(""));
  expect(db.updates).toEqual([{ category_id: null, category_manual: false }]);
});

it("non-admin roles still cannot change golongan", async () => {
  db.role = "STAFF";
  await expect(updateKategoriPelanggan(form("g-reseller"))).rejects.toThrow("/crm/pelanggan?error=");
  expect(db.updates).toHaveLength(0);
});
