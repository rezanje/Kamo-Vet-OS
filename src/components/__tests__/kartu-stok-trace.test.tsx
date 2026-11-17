// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Fictional fixtures only.
const recipeId = "11111111-2222-4333-8444-555555555555";
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

it("links each source number to its own document: direct purchase invoice, transfer request send and receive", async () => {
  const requestId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  fixture.docs = {
    purchase_invoices: [{ id: "inv-1", no_faktur: "FB.2026.11.00043" }],
    stock_requests: [{ id: requestId, no_request: "PRM-20261114-0002" }],
    stock_transfers: [{ id: "trf-1", no_pemindahan: "PMB-20261114-0001" }],
  };
  fixture.moves = [
    move(1, "2026-11-14", 20, { source: "faktur-langsung", source_ref: "FB.2026.11.00043" }),
    move(2, "2026-11-14", -20, { source: "kirim-permintaan", source_ref: "PRM-20261114-0002" }),
    move(3, "2026-11-14", 20, { source: "terima-permintaan", source_ref: requestId }),
    move(4, "2026-11-14", -1, { source: "transfer", source_ref: "PMB-20261114-0001" }),
    move(5, "2026-11-14", -1, { source: "transfer", source_ref: "PMB-HILANG-0009" }),
  ];
  const body = await render({ item: "material-1", dari: "2026-11-01", sampai: "2026-11-17" });
  expect(body.querySelector('a[href="/pembelian/faktur/inv-1"]')?.textContent).toBe("FB.2026.11.00043");
  expect(body.querySelector(`a[href="/pos/permintaan/${requestId}"]`)?.textContent).toBe("PRM-20261114-0002");
  expect(body.querySelectorAll(`a[href="/pos/permintaan/${requestId}"]`)).toHaveLength(2);
  expect(body.querySelector('a[href="/pos/pemindahan/trf-1"]')).not.toBeNull();
  // A number with no readable document stays plain text, never a dead link.
  expect(body.textContent).toContain("PMB-HILANG-0009");
  expect([...body.querySelectorAll("a")].some(a => a.textContent === "PMB-HILANG-0009")).toBe(false);
});

it("still shows the stock card when a document table cannot be read", async () => {
  fixture.docError = "purchase_invoices";
  fixture.moves = [move(1, "2026-11-14", 20, { source: "faktur-langsung", source_ref: "FB.2026.11.00043" })];
  const body = await render({ item: "material-1", dari: "2026-11-01", sampai: "2026-11-17" });
  expect(body.querySelector('[role="alert"]')).toBeNull();
  expect(body.textContent).toContain("FB.2026.11.00043");
  expect(body.textContent).toContain("Saldo akhir");
  expect([...body.querySelectorAll("a")].some(a => a.textContent === "FB.2026.11.00043")).toBe(false);
});
