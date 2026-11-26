import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ unitsError: false, unitsThrow: false, unitRows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    let start = 0, end = 499;
    const rows = () => {
      if (table === "opname_order_items") return [
        { id: "l1", item_id: "shampoo", items: { code: "SH", name: "Shampoo Grooming 3in1 20L", unit: "ML", sell_price: 1, item_categories: { name: "T" } } },
        { id: "l2", item_id: "th4", items: { code: "TH4", name: "TH4 Disinfektan", unit: "1L", sell_price: 1, item_categories: { name: "T" } } },
      ];
      return [];
    };
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q,
      range: (from: number, to: number) => { start = from; end = to; return q; },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "item_units") {
          if (fixture.unitsThrow) throw new Error("tabel tidak terbaca");
          return Promise.resolve(fixture.unitsError ? { data: null, error: { message: "x" } } : { data: fixture.unitRows, error: null }).then(resolve);
        }
        const all = rows();
        return Promise.resolve({ data: all.slice(start, end + 1), count: all.length, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));
import { DaftarHitung } from "@/app/kasir/opname/[id]/DaftarHitung";

beforeEach(() => { fixture.unitsError = false; fixture.unitsThrow = false; fixture.unitRows = [{ item_id: "shampoo", unit: "btl", factor: 500, sell_price: 0, buy_price: 0 }]; });

it("membawa isi kemasan dari item_units hanya untuk barang yang punya satuan lain", async () => {
  const form = await DaftarHitung({ orderId: "o", warehouseId: "w" });
  const [sh, th4] = form.props.rows;
  expect(sh.turunan).toEqual([{ unit: "btl", factor: 500 }]);
  expect(th4.turunan).toBeUndefined();
});
it("tetap tidak mengirim stok sistem ke peramban", async () => {
  const form = await DaftarHitung({ orderId: "o", warehouseId: "w" });
  for (const r of form.props.rows) expect(JSON.stringify(r)).not.toMatch(/qty_sistem|"qty"|sistem/);
});
it("galat baca satuan tidak menghentikan hitungan (tanpa data, isi kemasan dilewati)", async () => {
  fixture.unitsError = true;
  const form = await DaftarHitung({ orderId: "o", warehouseId: "w" });
  expect(form.props.rows).toHaveLength(2);
  expect(form.props.rows.every((r: { turunan?: unknown }) => r.turunan === undefined)).toBe(true);
  fixture.unitsError = false; fixture.unitsThrow = true;
  const f2 = await DaftarHitung({ orderId: "o", warehouseId: "w" });
  expect(f2.props.rows).toHaveLength(2);
});
it("satuan yang sama dengan satuan dasar tidak dianggap kemasan lain", async () => {
  fixture.unitRows = [{ item_id: "th4", unit: "1L", factor: 1, sell_price: 0, buy_price: 0 }];
  const form = await DaftarHitung({ orderId: "o", warehouseId: "w" });
  expect(form.props.rows[1].turunan).toBeUndefined();
});
