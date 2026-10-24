import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Read = { table: string; fields?: string; eq: Record<string, unknown>; from: number; to: number };
const state = vi.hoisted(() => ({ edit: true, failed: "", truncated: "", empty: false, reads: [] as Read[] }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => state.edit }));
vi.mock("@/app/(app)/pos/harga/actions", () => ({ simpanHargaJual: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const read: Read = { table, eq: {}, from: 0, to: 999 };
  state.reads.push(read);
  let counted = false, ids: string[] | undefined, search = "";
  const rows = (): Row[] => {
    if (table === "branches") return [{ id: "branch-a", name: "Branch A", code: "A", is_active: true }];
    if (table === "items") return state.empty ? [] : [...Array.from({ length: 1205 }, (_, i) => ({ id: `item-${i}`, code: `SKU-${i}`, name: `Fiction ${String(i).padStart(4, "0")}`, unit: "pcs", sell_price: 100, is_active: true })), { id: "inactive", is_active: false }];
    if (table === "item_units") return [{ id: "late-unit", item_id: "item-1009", unit: "box", factor: 24, sell_price: 2400, buy_price: 0 }];
    if (table === "item_branch_prices") return Array.from({ length: 1205 }, (_, i) => ({ id: `override-${i}`, item_id: "item-0", unit: "pcs", branch_id: i === 1204 ? "branch-a" : `other-${i}`, sell_price: i === 1204 ? 0 : 90 }));
    return [];
  };
  const result = () => {
    const all = rows().filter(row => Object.entries(read.eq).every(([key, value]) => row[key] === value))
      .filter(row => !ids || ids.includes(String(table === "items" ? row.id : row.item_id)))
      .filter(row => !search || [row.name, row.code].some(value => String(value ?? "").toLowerCase().includes(search.toLowerCase())));
    const data = all.slice(read.from, read.to + 1);
    if (state.truncated === table) data.pop();
    return { data, count: counted ? all.length : null, error: state.failed === table ? { message: "private price fixture" } : null };
  };
  const query = {
    select(fields: string, options?: { count: string }) { read.fields = fields; counted = options?.count === "exact"; return query; },
    eq(key: string, value: unknown) { read.eq[key] = value; return query; }, order() { return query; },
    or(expression: string) { search = expression.match(/name\.ilike\.%(.+?)%/)?.[1] ?? ""; return query; },
    in(_key: string, values: string[]) { ids = values; return query; },
    range(from: number, to: number) { read.from = from; read.to = to; return query; }, limit(size: number) { read.to = size - 1; return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return query;
} }) }));
import Page from "@/app/(app)/pos/harga/page";
const render = async (params: { hal?: string; q?: string; cabang?: string } = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
beforeEach(() => { state.edit = true; state.failed = ""; state.truncated = ""; state.empty = false; state.reads = []; });

it("provides bounded checked price pages instead of an unreachable first150 cap", async () => {
  const html = await render();
  expect((html.match(/name="h\|item-\d+\|pcs"/g) ?? [])).toHaveLength(50);
  expect(html).toContain("1205"); expect(html).toContain("Halaman 1/25"); expect(html).toContain("hal=2");
  expect(html).not.toContain("150 barang pertama");
});
it("reaches late products with existing units and preserves branch/search in back and next links", async () => {
  const html = await render({ hal: "21", q: "Fiction", cabang: "branch-a" });
  expect(html).toContain('name="h|item-1009|box"'); expect(html).toContain("Rp 2.400"); expect(html).toContain("24 pcs"); expect(html).toContain("Halaman 21/25");
  expect(html).toContain("cabang=branch-a"); expect(html).toContain("q=Fiction"); expect(html).toContain("hal=20"); expect(html).toContain("hal=22");
  expect(state.reads.filter(read => read.table === "items").map(read => [read.from, read.to])).toEqual([[0, 49], [1000, 1049]]);
});
it("counts every permitted override and preserves an explicit zero branch price", async () => {
  expect(await render()).toContain("1205 cabang");
  expect(state.reads.filter(read => read.table === "item_branch_prices").every(read => !read.fields?.includes("sell_price"))).toBe(true);
  state.reads = [];
  const html = await render({ cabang: "branch-a" });
  expect(html).toMatch(/name="h\|item-0\|pcs"[^>]*value="0"/);
  expect(state.reads.filter(read => read.table === "item_branch_prices").every(read => read.eq.branch_id === "branch-a")).toBe(true);
});
it.each(["branches", "items", "item_units", "item_branch_prices"])("shows retry context without a writable partial table on %s failure", async table => {
  state.failed = table;
  let html = await render(table === "item_units" ? { hal: "21" } : {});
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="h|'); expect(html).not.toContain("private price fixture");
  state.failed = ""; state.truncated = table;
  html = await render(table === "item_units" ? { hal: "21" } : {});
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="h|');
});
it("searches a precise late code without requiring traversal and counts only matching active products", async () => {
  const html = await render({ q: "SKU-1204" });
  expect(html).toContain('name="h|item-1204|pcs"'); expect(html).not.toContain('name="h|item-0|pcs"');
  expect(html).toContain("dari 1 · Halaman 1/1"); expect(html).not.toContain("Berikutnya");
});
it("distinguishes empty/invalid pages and retains readonly price controls", async () => {
  state.edit = false;
  let html = await render({ hal: "999" });
  expect(html).toContain("Halaman 1/25"); expect(html).not.toContain("Simpan harga"); expect(html).toMatch(/<input(?=[^>]*name="h\|item-0\|pcs")(?=[^>]*disabled)[^>]*>/);
  state.empty = true;
  html = await render();
  expect(html).toContain("Belum ada barang aktif"); expect(html).toContain("Menampilkan 0–0"); expect(html).not.toContain('role="alert"');
});
