import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, errorTable: "", nullTable: "", writes: [] as Row[][], pages: [] as { table: string; from: number }[] }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fixture-owner" } } }) },
  from(table: string) {
    let from = 0, to = 999;
    const filters: [string, unknown][] = [];
    let insertion: Row[] | undefined;
    const result = () => {
      if (db.errorTable === table && !insertion) return { data: null, error: { message: "Fixture read failure" } };
      if (db.nullTable === table && !insertion) return { data: null, error: null };
      if (insertion) {
        if (insertion.some(row => db.tables.items.some(item => item.code === row.code))) return { data: null, error: { message: "duplicate key" } };
        db.writes.push(insertion); db.tables.items.push(...insertion);
        return { data: null, error: null };
      }
      const rows = table === "profiles" ? [{ id: "fixture-owner", role: "OWNER", is_active: true }] : db.tables[table] ?? [];
      return { data: rows.filter(row => filters.every(([key, value]) => row[key] === value)).slice(from, to + 1), error: null };
    };
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      range: (first: number, last: number) => { from = first; to = last; db.pages.push({ table, from }); return q; },
      insert: (rows: Row[]) => { insertion = rows; return q; },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  },
}) }));
import { imporBarang } from "@/app/(app)/pos/sku/impor/actions";
const form = (rows = ["FIX-NEW,Fiction new,Fiction category,10"]) => {
  const f = new FormData(); f.set("csv", ["kode,nama,kategori,harga_jual", ...rows].join("\n")); return f;
};
beforeEach(() => {
  db.errorTable = ""; db.nullTable = ""; db.writes = []; db.pages = [];
  db.tables = { item_categories: [{ id: "category", name: "Fiction category", parent_id: null, is_active: true }], brands: [], units: [{ nama: "pcs", is_active: true }], items: [] };
});

it("does not interpret an unknown null read as an empty item master", async () => {
  db.nullTable = "items";
  await expect(imporBarang(form())).rejects.toThrow("error=");
  expect(db.writes).toEqual([]);
});

it.each(["items", "item_categories", "brands", "units"])("does not import or misdiagnose missing references when %s cannot be read", async table => {
  db.errorTable = table;
  try { await imporBarang(form()); throw new Error("Expected error redirect"); }
  catch (error) { expect(decodeURIComponent(String(error))).toContain("Data master belum dapat dimuat"); }
  expect(db.writes).toEqual([]);
});

it("finds late references and existing codes after the first API page, imports only the new row, and rejects retry duplicates", async () => {
  db.tables.item_categories = Array.from({ length: 1000 }, (_, i) => ({ id: "c" + i, name: "Unused category " + i, is_active: true }));
  db.tables.item_categories.push({ id: "late-category", name: "Fiction category", parent_id: null, is_active: true });
  db.tables.units = Array.from({ length: 1000 }, (_, i) => ({ nama: "unused" + i, is_active: true }));
  db.tables.units.push({ nama: "pcs", is_active: true });
  db.tables.items = Array.from({ length: 1000 }, (_, i) => ({ code: "UNUSED-" + i })); db.tables.items.push({ code: "FIX-EXISTING" });
  const input = form(["FIX-NEW,Fiction new,Fiction category,10", "FIX-EXISTING,Fiction existing,Fiction category,10"]);
  await expect(imporBarang(input)).rejects.toThrow("success=");
  expect(db.writes.flat().map(row => row.code)).toEqual(["FIX-NEW"]);
  for (const table of ["items", "item_categories", "units"]) expect(db.pages).toContainEqual({ table, from: 1000 });
  await expect(imporBarang(input)).rejects.toThrow("error=");
  expect(db.writes).toHaveLength(1);
});

it("keeps inactive categories and units unavailable instead of enabling them through the paginated loader", async () => {
  db.tables.item_categories[0].is_active = false;
  await expect(imporBarang(form())).rejects.toThrow("error="); expect(db.writes).toEqual([]);
  db.tables.item_categories[0].is_active = true; db.tables.units[0].is_active = false;
  await expect(imporBarang(form())).rejects.toThrow("error="); expect(db.writes).toEqual([]);
});
