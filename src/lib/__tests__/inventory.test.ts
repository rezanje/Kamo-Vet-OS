import { describe, expect, it } from "vitest";
import { StockError, consumeLayers, stockIn, transferStock } from "../inventory";

// Supabase palsu seadanya: cukup untuk chain yang dipakai inventory.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type FakeDb = { stock: Record<string, number>; layers: Any[] };

function makeClient(db: FakeDb, failTable?: string) {
  return {
    from(table: string) {
      const f: Record<string, Any> = {};
      let mode = "select";
      let payload: Any = {};
      const key = () => `${f.warehouse_id}|${f.item_id}`;
      const run = () => {
        if (failTable === table && mode !== "select") return { data: null, error: { message: "ditolak" } };
        if (mode === "insert") {
          if (table === "stock_layers") db.layers.push({ ...payload, id: `L${db.layers.length + 1}` });
          if (table === "stock") db.stock[`${payload.warehouse_id}|${payload.item_id}`] = Number(payload.qty);
          return { data: null, error: null };
        }
        if (mode === "update") {
          if (table === "stock") db.stock[key()] = Number(payload.qty);
          if (table === "stock_layers") {
            const l = db.layers.find((x) => x.id === f.id);
            if (l) l.qty_left = Number(payload.qty_left);
          }
          return { data: null, error: null };
        }
        if (table === "stock") return { data: key() in db.stock ? { qty: db.stock[key()] } : null, error: null };
        if (table === "items") return { data: { buy_price: 1000 }, error: null };
        if (table === "stock_layers") {
          return {
            data: db.layers.filter(
              (l) => l.warehouse_id === f.warehouse_id && l.item_id === f.item_id && Number(l.qty_left) > 0,
            ),
            error: null,
          };
        }
        return { data: null, error: null };
      };
      const self: Any = {
        select: () => ((mode = "select"), self),
        insert: (v: Any) => ((mode = "insert"), (payload = v), self),
        update: (v: Any) => ((mode = "update"), (payload = v), self),
        eq: (k: string, v: Any) => ((f[k] = v), self),
        gt: () => self,
        order: () => self,
        maybeSingle: async () => run(),
        then: (res: Any, rej: Any) => Promise.resolve(run()).then(res, rej),
      };
      return self;
    },
  };
}

const L = (id: string, qty_left: number, unit_cost: number) => ({ id, qty_left, unit_cost });

describe("consumeLayers (FIFO)", () => {
  it("habiskan layer tertua dulu, cost campuran benar", () => {
    // 5 @1000 lalu 5 @2000; ambil 7 → 5×1000 + 2×2000 = 9000
    const { takes, cost, shortfall } = consumeLayers([L("a", 5, 1000), L("b", 5, 2000)], 7);
    expect(cost).toBe(9000);
    expect(shortfall).toBe(0);
    expect(takes).toEqual([
      { id: "a", qty: 5, unit_cost: 1000 },
      { id: "b", qty: 2, unit_cost: 2000 },
    ]);
  });

  it("qty pas satu layer", () => {
    const { takes, cost } = consumeLayers([L("a", 5, 1000)], 5);
    expect(cost).toBe(5000);
    expect(takes).toHaveLength(1);
  });

  it("layer kurang -> shortfall dilaporkan", () => {
    const { cost, shortfall } = consumeLayers([L("a", 3, 1000)], 10);
    expect(cost).toBe(3000);
    expect(shortfall).toBe(7);
  });

  it("tanpa layer -> semua shortfall", () => {
    expect(consumeLayers([], 4)).toEqual({ takes: [], cost: 0, shortfall: 4 });
  });

  it("layer kosong (qty_left 0) dilewati", () => {
    const { takes } = consumeLayers([L("a", 0, 1000), L("b", 5, 2000)], 2);
    expect(takes).toEqual([{ id: "b", qty: 2, unit_cost: 2000 }]);
  });
});

describe("transferStock (penerimaan permintaan barang)", () => {
  it("gudang pengirim berkurang, gudang penerima bertambah", async () => {
    const db: FakeDb = {
      stock: { "dc|itm": 10 },
      layers: [{ id: "L0", warehouse_id: "dc", item_id: "itm", qty_left: 10, unit_cost: 5000 }],
    };
    await transferStock(makeClient(db), {
      fromWarehouseId: "dc", toWarehouseId: "toko", itemId: "itm", qty: 4, source: "terima-permintaan",
    });
    expect(db.stock["dc|itm"]).toBe(6);
    expect(db.stock["toko|itm"]).toBe(4);
  });
});

describe("stok gagal ditulis", () => {
  it("stockIn melempar StockError, bukan diam-diam sukses", async () => {
    const db: FakeDb = { stock: {}, layers: [] };
    await expect(
      stockIn(makeClient(db, "stock_layers"), {
        warehouseId: "toko", itemId: "itm", qty: 3, unitCost: 1000, source: "terima-permintaan",
      }),
    ).rejects.toBeInstanceOf(StockError);
    expect(db.stock["toko|itm"]).toBeUndefined();
  });
});
