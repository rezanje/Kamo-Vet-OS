import { describe, expect, it } from "vitest";
import { hitungHppPaket, loadPaketHpp } from "@/lib/promo-paket-hpp";

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

describe("loadPaketHpp — read-only (select only), branch-scoped warehouses", () => {
  it("reads items, units, the branch warehouses' remaining layers and never writes", async () => {
    const seen: string[] = [];
    const db = {
      from(table: string) {
        const q: Record<string, unknown> = {};
        for (const m of ["insert", "update", "delete", "upsert"]) q[m] = () => { throw new Error(`write ${m} on ${table}`); };
        q.select = () => { seen.push(`select ${table}`); return q; };
        q.in = (col: string, vals: unknown[]) => { seen.push(`in ${table}.${col}=${(vals as string[]).length}`); return q; };
        q.gt = () => q; q.eq = () => q; q.order = () => q; q.range = () => q;
        q.then = (res: (v: unknown) => unknown) => {
          const rows: Record<string, unknown>[] = table === "items" ? items : table === "item_units" ? units.map((u, i) => ({ id: `u${i}`, ...u })) : table === "warehouses" ? [{ id: "w1" }] : table === "stock_layers" ? [{ id: "l1", item_id: ANC, unit_cost: 14500, qty_left: 3 }] : [];
          return Promise.resolve({ data: rows, count: rows.length, error: null }).then(res);
        };
        return q;
      },
    };
    const rows = await loadPaketHpp(db, [{ item_id: ANC, unit: "PCS" }], ["b1"]);
    expect(rows).toEqual([{ item_id: ANC, unit: "PCS", price: 15000, hpp: 14500, source: "lapisan" }]);
    expect(seen).toEqual(expect.arrayContaining(["select items", "select item_units", "select warehouses", "select stock_layers", "in warehouses.branch_id=1"]));
  });
  it("a failed read throws (the caller must not treat it as 'no loss')", async () => {
    const db = { from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.in = () => q; q.gt = () => q; q.eq = () => q; q.order = () => q; q.range = () => q; q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: "boom" } }).then(res); return q; } };
    await expect(loadPaketHpp(db, [{ item_id: ANC, unit: "PCS" }], [])).rejects.toThrow();
  });
});
