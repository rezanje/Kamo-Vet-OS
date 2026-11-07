import { describe, expect, it } from "vitest";
import { hitungHppPaket, loadPaketHpp, type HppRow } from "@/lib/promo-paket-hpp";

const ANC = "33333333-3333-4333-8333-333333333333", BOLT = "11111111-1111-4111-8111-111111111111";
const items = [{ id: ANC, unit: "PCS", sell_price: 15000, buy_price: 12000 }, { id: BOLT, unit: "PCS", sell_price: 20000, buy_price: 0 }];
const units = [{ item_id: BOLT, unit: "BOX", factor: 12, sell_price: 230000 }];

describe("hitungHppPaket — price and HPP per unit for the editor's loss estimate", () => {
  it("uses the highest remaining stock layer (conservative, same stance as the cashier quote) over the master buy price", () => {
    const rows = hitungHppPaket([{ item_id: ANC, unit: "PCS" }], items, units, [{ item_id: ANC, unit_cost: 14000 }, { item_id: ANC, unit_cost: 14500 }]);
    expect(rows).toEqual([{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" }]);
  });
  it("falls back to the master buy price, then to unknown (null) — never to 0", () => {
    expect(hitungHppPaket([{ item_id: ANC, unit: "PCS" }], items, units, [])[0]).toMatchObject({ hpp: 12000, source: "harga_beli" });
    expect(hitungHppPaket([{ item_id: BOLT, unit: "PCS" }], items, units, [])[0]).toMatchObject({ hpp: null, source: null });
    expect(hitungHppPaket([{ item_id: BOLT, unit: "PCS" }], items, units, [{ item_id: BOLT, unit_cost: 0 }])[0]).toMatchObject({ hpp: null });
  });
  it("derived units: own sell price, HPP scaled by the factor", () => {
    const [r] = hitungHppPaket([{ item_id: BOLT, unit: "BOX" }], items, units, [{ item_id: BOLT, unit_cost: 15000 }]);
    expect(r).toEqual({ item_id: BOLT, unit: "BOX", price: 230000, hpp: 180000, source: "lapisan" });
  });
  it("unknown item or unit yields price 0 and unknown HPP (the editor validation reports the item)", () => {
    expect(hitungHppPaket([{ item_id: "x", unit: "PCS" }, { item_id: ANC, unit: "KARUNG" }], items, units, [])).toEqual([
      { item_id: "x", unit: "PCS", price: 0, hpp: null, source: null }, { item_id: ANC, unit: "KARUNG", price: 0, hpp: null, source: null },
    ]);
  });
});

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
/** Tiny in-memory PostgREST stand-in: select/eq/in/gt/order/range over real rows, records every read and refuses writes. */
function fakeDb(tables: Tables, log: string[] = []) {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let range: [number, number] | null = null;
      const q: Record<string, unknown> = {};
      for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => { throw new Error(`write ${m} on ${table}`); };
      q.select = () => q;
      q.eq = (col: string, v: unknown) => { log.push(`eq ${table}.${col}=${String(v)}`); filters.push((r) => r[col] === v); return q; };
      q.in = (col: string, vals: unknown[]) => { log.push(`in ${table}.${col}=${vals.length}`); filters.push((r) => vals.includes(r[col])); return q; };
      q.gt = (col: string, v: number) => { filters.push((r) => Number(r[col]) > v); return q; };
      q.order = () => q;
      q.range = (from: number, to: number) => { range = [from, to]; return q; };
      q.then = (res: (v: unknown) => unknown) => {
        const all = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        const rows = range ? all.slice(range[0], range[1] + 1) : all;
        return Promise.resolve({ data: rows, count: all.length, error: null }).then(res);
      };
      return q;
    },
  };
}
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const baseTables = (): Tables => ({
  items: items as unknown as Row[],
  item_units: units.map((u, i) => ({ id: `u${i}`, ...u })),
  branches: [{ id: A, type: "PETSHOP", is_active: true }, { id: B, type: "PETSHOP", is_active: true }, { id: C, type: "KLINIK", is_active: true }],
  warehouses: [
    { id: "wA-retail", branch_id: A, type: "RETAIL", is_active: true },
    { id: "wA-expired", branch_id: A, type: "EXPIRED", is_active: true },
    { id: "wA-online", branch_id: A, type: "ONLINE", is_active: true },
    { id: "wB-retail", branch_id: B, type: "RETAIL", is_active: true },
    { id: "wB-retail-old", branch_id: B, type: "RETAIL", is_active: false },
    { id: "wC-vet", branch_id: C, type: "VET", is_active: true },
  ],
  stock_layers: [
    { id: "l1", item_id: ANC, warehouse_id: "wA-retail", unit_cost: 13000, qty_left: 3 },
    { id: "l2", item_id: ANC, warehouse_id: "wA-expired", unit_cost: 99000, qty_left: 3 },
    { id: "l3", item_id: ANC, warehouse_id: "wA-online", unit_cost: 98000, qty_left: 3 },
    { id: "l4", item_id: ANC, warehouse_id: "wC-vet", unit_cost: 97000, qty_left: 3 },
    { id: "l5", item_id: ANC, warehouse_id: "wB-retail", unit_cost: 14000, qty_left: 3 },
    { id: "l6", item_id: ANC, warehouse_id: "wB-retail-old", unit_cost: 96000, qty_left: 3 },
    { id: "l7", item_id: ANC, warehouse_id: "wB-retail", unit_cost: 50000, qty_left: 0 },
  ],
  item_branch_prices: [],
});
const hppOf = (rows: HppRow[]) => rows.map((r) => ({ price: r.price, hpp: r.hpp, branch_ids: r.branch_ids }));

describe("loadPaketHpp — read-only, retail (petshop) warehouses of the chosen branches only, branch prices like the cashier", () => {
  it("never writes, only selects", async () => {
    const t = baseTables(); const log: string[] = [];
    await loadPaketHpp(fakeDb(t, log), [{ item_id: ANC, unit: "PCS" }], [A]);
    expect(log.length).toBeGreaterThan(0);
  });
  it("HPP comes from RETAIL + active warehouses only: expired/online/clinic/inactive layers and empty layers never inflate it", async () => {
    const rows = await loadPaketHpp(fakeDb(baseTables()), [{ item_id: ANC, unit: "PCS" }], [A]);
    expect(hppOf(rows)).toEqual([{ price: 15000, hpp: 13000, branch_ids: [A] }]);
  });
  it("an empty branch list means every active branch's retail warehouse (still no clinic/expired warehouses); distinct costs → one row per distinct (price,hpp)", async () => {
    const rows = await loadPaketHpp(fakeDb(baseTables()), [{ item_id: ANC, unit: "PCS" }], []);
    expect(hppOf(rows).sort((x, y) => (x.hpp ?? 0) - (y.hpp ?? 0))).toEqual([{ price: 15000, hpp: 13000, branch_ids: [A] }, { price: 15000, hpp: 14000, branch_ids: [B] }]);
    expect(rows.every((r) => (r.hpp ?? 0) < 90000)).toBe(true);
  });
  it("branches with identical price and HPP are merged into one row", async () => {
    const t = baseTables(); t.stock_layers = [{ id: "x1", item_id: ANC, warehouse_id: "wA-retail", unit_cost: 14000, qty_left: 1 }, { id: "x2", item_id: ANC, warehouse_id: "wB-retail", unit_cost: 14000, qty_left: 1 }];
    const rows = await loadPaketHpp(fakeDb(t), [{ item_id: ANC, unit: "PCS" }], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ price: 15000, hpp: 14000 });
    expect([...(rows[0].branch_ids ?? [])].sort()).toEqual([A, B].sort());
  });
  it("uses the per-branch sell price the cashier uses (item_branch_prices over the master price; unit-specific)", async () => {
    const t = baseTables();
    t.item_branch_prices = [{ id: "p1", branch_id: B, item_id: ANC, unit: "PCS", sell_price: 13500 }, { id: "p2", branch_id: B, item_id: BOLT, unit: "BOX", sell_price: 200000 }];
    const rows = await loadPaketHpp(fakeDb(t), [{ item_id: ANC, unit: "PCS" }], []);
    expect(hppOf(rows).sort((x, y) => x.price - y.price)).toEqual([{ price: 13500, hpp: 14000, branch_ids: [B] }, { price: 15000, hpp: 13000, branch_ids: [A] }]);
    const box = await loadPaketHpp(fakeDb(t), [{ item_id: BOLT, unit: "BOX" }], [B]);
    expect(box[0]).toMatchObject({ price: 200000 });
  });
  it("a chosen branch that is unknown/inactive is ignored; more ids than branches exist is refused (throws, no query storm)", async () => {
    const ghost = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const rows = await loadPaketHpp(fakeDb(baseTables()), [{ item_id: ANC, unit: "PCS" }], [A, ghost]);
    expect(hppOf(rows)).toEqual([{ price: 15000, hpp: 13000, branch_ids: [A] }]);
    const tooMany = Array.from({ length: 4 }, (_, i) => `eeeeeeee-eeee-4eee-8eee-${String(i).padStart(12, "0")}`);
    await expect(loadPaketHpp(fakeDb(baseTables()), [{ item_id: ANC, unit: "PCS" }], tooMany)).rejects.toThrow(/cabang/i);
  });
  it("an inactive branch is never part of the estimate, even with a retail warehouse and layers, and even when chosen explicitly", async () => {
    const t = baseTables(); t.branches = [{ id: A, type: "PETSHOP", is_active: false }, { id: B, type: "PETSHOP", is_active: true }];
    const all = await loadPaketHpp(fakeDb(t), [{ item_id: ANC, unit: "PCS" }], []);
    expect(hppOf(all)).toEqual([{ price: 15000, hpp: 14000, branch_ids: [B] }]);
    const chosen = await loadPaketHpp(fakeDb(t), [{ item_id: ANC, unit: "PCS" }], [A, B]);
    expect(hppOf(chosen)).toEqual([{ price: 15000, hpp: 14000, branch_ids: [B] }]);
  });
  it("a clinic-only selection has no retail warehouse: HPP falls back to the master buy price, never to clinic layers", async () => {
    const rows = await loadPaketHpp(fakeDb(baseTables()), [{ item_id: ANC, unit: "PCS" }], [C]);
    expect(rows[0]).toMatchObject({ hpp: 12000, source: "harga_beli" });
  });
  it("many retail warehouses are all read (no silent truncation at 200)", async () => {
    const t = baseTables(); t.branches = []; t.warehouses = []; t.stock_layers = [];
    for (let i = 0; i < 250; i++) {
      const id = `ffffffff-ffff-4fff-8fff-${String(i).padStart(12, "0")}`;
      t.branches.push({ id, type: "PETSHOP", is_active: true }); t.warehouses.push({ id: `w${i}`, branch_id: id, type: "RETAIL", is_active: true });
    }
    t.stock_layers.push({ id: "last", item_id: ANC, warehouse_id: "w249", unit_cost: 14900, qty_left: 1 });
    const rows = await loadPaketHpp(fakeDb(t), [{ item_id: ANC, unit: "PCS" }], []);
    expect(rows.some((r) => r.hpp === 14900)).toBe(true);
  });
  it("a failed read throws (the caller must not treat it as 'no loss')", async () => {
    const db = { from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.in = () => q; q.gt = () => q; q.eq = () => q; q.order = () => q; q.range = () => q; q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: "boom" } }).then(res); return q; } };
    await expect(loadPaketHpp(db, [{ item_id: ANC, unit: "PCS" }], [])).rejects.toThrow();
  });
});
