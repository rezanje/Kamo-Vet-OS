// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Fictional fixtures only.
const recipeId = "11111111-2222-4333-8444-555555555555";
const fixture = vi.hoisted(() => ({ moves: [] as Record<string, unknown>[], failRead: -1, reads: 0, warehouseError: false }));
vi.mock("@/lib/permintaan", () => ({ loadKatalogPermintaan: async () => [{ id: "material-1", code: "MAT-1", name: "Fictional material", unit: "ml" }] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const filters: [string, string, string][] = [];
    let start = 0, end = 999, ranged = false;
    const query = {
      select: () => query, order: () => query,
      eq: (c: string, v: string) => { filters.push(["eq", c, v]); return query; },
      lt: (c: string, v: string) => { filters.push(["lt", c, v]); return query; },
      gte: (c: string, v: string) => { filters.push(["gte", c, v]); return query; },
      lte: (c: string, v: string) => { filters.push(["lte", c, v]); return query; },
      range: (from: number, to: number) => { start = from; end = to; ranged = true; return query; },
      then(resolve: (value: unknown) => unknown) {
        if (table === "warehouses") return Promise.resolve(fixture.warehouseError ? { data: null, error: { message: "unavailable" } }
          : { data: [{ id: "wh-1", code: "WH1", name: "Fictional warehouse" }], error: null }).then(resolve);
        const read = fixture.reads++;
        if (read === fixture.failRead) return Promise.resolve({ data: null, count: null, error: { message: "unavailable" } }).then(resolve);
        const rows = fixture.moves.filter(m => filters.every(([op, c, v]) => c === "item_id" || c === "warehouse_id" ? m[c] === v
          : op === "lt" ? String(m[c]) < v : op === "gte" ? String(m[c]) >= v : String(m[c]) <= v));
        // Mirrors the hosted API row cap: an unranged read silently stops at 1000 rows.
        const page = ranged ? rows.slice(start, end + 1) : rows.slice(0, 1000);
        return Promise.resolve({ data: page, count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));
import KartuStokPage from "@/app/(app)/pos/kartu-stok/page";

const move = (i: number, tanggal: string, qty: number, extra: Record<string, unknown> = {}) => ({
  id: `move-${String(i).padStart(5, "0")}`, item_id: "material-1", warehouse_id: "wh-1", tanggal, qty, unit_cost: 1,
  source: "purchase", source_ref: null, warehouses: { code: "WH1", name: "Fictional warehouse" }, ...extra,
});
beforeEach(() => { fixture.moves = []; fixture.failRead = -1; fixture.reads = 0; fixture.warehouseError = false; });
async function render(params: Record<string, string>) {
  document.body.innerHTML = renderToStaticMarkup(await KartuStokPage({ searchParams: Promise.resolve(params) }));
  return document.body;
}

it("loads the complete ledger beyond the API row cap so balances and the racik movement are not dropped", async () => {
  fixture.moves = [
    ...Array.from({ length: 1200 }, (_, i) => move(i, "2026-08-01", 1)),
    ...Array.from({ length: 1100 }, (_, i) => move(2000 + i, "2026-09-10", 1)),
    move(9999, "2026-09-15", -2, { source: "racik", source_ref: recipeId }),
  ];
  const body = await render({ item: "material-1", dari: "2026-09-01", sampai: "2026-09-30" });
  expect(body.textContent).toContain("Saldo per 2026-09-01");
  const rows = body.querySelectorAll("table tbody tr");
  expect(rows[rows.length - 1].textContent).toContain((2298).toLocaleString("id-ID"));
  expect(body.querySelector(`a[href="/klinik/racik/${recipeId}"]`)).not.toBeNull();
});

it.each([0, 1, 2])("shows no balances or empty-ledger claim when stock read %i fails", async failRead => {
  fixture.failRead = failRead;
  fixture.moves = [move(1, "2026-09-15", -2, { source: "racik", source_ref: recipeId })];
  const body = await render({ item: "material-1", dari: "2026-09-01", sampai: "2026-09-30" });
  expect(body.querySelector('[role="alert"]')?.textContent).toContain("belum dapat dimuat");
  expect(body.textContent).not.toContain("Saldo akhir");
  expect(body.textContent).not.toContain("Tidak ada mutasi");
  expect(body.querySelector(`a[href="/klinik/racik/${recipeId}"]`)).toBeNull();
});

it("does not drop a warehouse filter into all-warehouse totals when warehouses cannot be read", async () => {
  fixture.warehouseError = true;
  fixture.moves = [move(1, "2026-09-15", 5)];
  const body = await render({ item: "material-1", gudang: "wh-1", dari: "2026-09-01", sampai: "2026-09-30" });
  expect(body.querySelector('[role="alert"]')?.textContent).toContain("Daftar gudang belum dapat dimuat");
  expect(body.textContent).not.toContain("Saldo akhir");
  expect(fixture.reads).toBe(0);
});

it("says a linked material is unavailable instead of silently showing an empty picker", async () => {
  const body = await render({ item: "deleted-material", dari: "2026-09-01" });
  expect(body.querySelector('[role="alert"]')?.textContent).toContain("tidak ditemukan atau tidak aktif");
  expect(fixture.reads).toBe(0);
});
