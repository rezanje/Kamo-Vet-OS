// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Fictional fixtures only.
const fixture = vi.hoisted(() => ({ moves: [] as Record<string, unknown>[], failRead: -1, reads: 0, warehouseError: false,
  docs: {} as Record<string, Record<string, unknown>[]>, docError: "" }));
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
      in: (c: string, v: string[]) => { filters.push(["in", c, JSON.stringify(v)]); return query; },
      then(resolve: (value: unknown) => unknown) {
        if (table in fixture.docs || table === fixture.docError) {
          if (table === fixture.docError) return Promise.resolve({ data: null, error: { message: "denied" } }).then(resolve);
          const f = filters.find(([op]) => op === "in")!;
          const wanted = JSON.parse(f[2]) as string[];
          return Promise.resolve({ data: fixture.docs[table].filter(r => wanted.includes(String(r[f[1]]))), error: null }).then(resolve);
        }
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
beforeEach(() => { fixture.moves = []; fixture.failRead = -1; fixture.reads = 0; fixture.warehouseError = false; fixture.docs = {}; fixture.docError = ""; });
async function render(params: Record<string, string>) {
  document.body.innerHTML = renderToStaticMarkup(await KartuStokPage({ searchParams: Promise.resolve(params) }));
  return document.body;
}
const rows = (body: HTMLElement) => [...body.querySelectorAll("table")].at(-1)!.querySelectorAll("tbody tr");

it("SO selisih lebih (+) tampil di kartu stok dengan no. OPR, arah (+), jumlah masuk, dan nilai satuan HPP", async () => {
  fixture.moves = [
    move(1, "2026-11-20", 10, { source: "purchase", unit_cost: 100 }),
    move(2, "2026-11-24", 4, { source: "opname", source_ref: "OPR.00011", unit_cost: 100 }),
    move(3, "2026-11-24", -2, { source: "opname", source_ref: "OPR.00011", unit_cost: 100 }),
  ];
  const body = await render({ item: "material-1", dari: "2026-11-01", sampai: "2026-11-30" });
  const tr = [...rows(body)];
  const plus = tr.find(r => r.textContent!.includes("selisih lebih"))!;
  expect(plus.textContent).toContain("OPR.00011");
  expect(plus.textContent).toContain("Stok Opname — selisih lebih (+)");
  expect(plus.textContent).toContain("100");
  expect(plus.querySelector("[data-tanpa-harga]")).toBeNull();
  const minus = tr.find(r => r.textContent!.includes("selisih kurang"))!;
  expect(minus.textContent).toContain("Stok Opname — selisih kurang (−)");
  expect(tr.at(-1)!.textContent).toContain("12"); // saldo 10 + 4 - 2
});

it("SO selisih lebih tanpa harga (data lama) ditandai 'Rp 0 (belum ada harga)', bukan tanda hubung kosong", async () => {
  fixture.moves = [move(1, "2026-11-24", 17, { source: "opname", source_ref: "OPR.00011", unit_cost: 0 }),
    move(2, "2026-11-24", -3, { source: "sale", source_ref: "POS-1", unit_cost: 0 })];
  const body = await render({ item: "material-1", dari: "2026-11-01", sampai: "2026-11-30" });
  const flagged = body.querySelectorAll("[data-tanpa-harga]");
  expect(flagged.length).toBe(1);
  expect(flagged[0].textContent).toContain("belum ada harga");
});
