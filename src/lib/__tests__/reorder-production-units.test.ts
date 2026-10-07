import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ writes: [] as { table: string; value: unknown }[], removed: false, buyUnit: "box" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/no-dokumen", () => ({ formatDokumen: async () => ({ prefix: "PO", digit: 3 }), urutanBerikutnya: async () => 1, formatNomor: () => "PO001" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
 rpc: async (_name: string, value: unknown) => { state.writes.push({table:"rpc",value}); return {data:"saved",error:null}; },
 auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
 from(table: string) {
  let ids: string[] | undefined;
  const items = [{ id: "material", name: "Material", unit: "gr", buy_unit: "kg", buy_price: 2, sell_price: 3, is_active: true, item_type: "Persediaan" }, { id: "output", name: "Output", unit: "pcs", buy_unit: state.buyUnit, buy_price: 2, sell_price: 3, is_active: true, item_type: "Persediaan" }];
  const all = table === "items" ? items : table === "item_units" ? [{ item_id: "material", unit: "kg", factor: 1000, buy_price: 2000, sell_price: 3000 }, ...(state.removed ? [] : [{ item_id: "output", unit: "box", factor: 12, buy_price: 24, sell_price: 36 }])] : [];
  const rows = () => all.filter(row => !ids || ids.includes("item_id" in row ? row.item_id : row.id));
  const query = {
   select: () => query, eq: () => query, ilike: () => query, order: () => query, range: () => query,
   in: (_column: string, value: string[]) => { ids = value; return query; },
   insert: (value: unknown) => { state.writes.push({ table, value }); return query; },
   update: (value: unknown) => { state.writes.push({ table, value }); return query; },
   delete: () => query,
   single: async () => ({ data: { id: "saved" }, error: null }),
   maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER" } : table === "units" ? { nama: "pcs" } : { id: "warehouse", branch_id: "branch" }, error: null }),
   then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return query;
 },
}) }));
import { buatPOdariUsulan } from "../../app/(app)/pos/stok-minimum/actions";
import { simpanResep } from "../../app/(app)/pos/produksi/actions";
import { simpanBarang } from "../../app/(app)/pos/sku/actions";
function form(values: Record<string, string>) { const f = new FormData(); Object.entries(values).forEach(([key, value]) => f.set(key, value)); return f; }
beforeEach(() => { state.writes.length = 0; state.removed = false; state.buyUnit = "box"; });
it("rejects a purchase unit without an item conversion before saving the SKU", async () => {
 const f = form({ name: "Output", code: "O", category_id: "cat", item_type: "Persediaan", unit: "pcs", buy_unit: "box", units: "[]" });
 await expect(simpanBarang(f)).rejects.toThrow(/satuan|Satuan/);
 expect(state.writes).toEqual([]);
});
it.each(["deleted", "unconfigured"])("preflights every supplier group before writing an automatic PO (%s unit)", async kind => {
 state.removed = kind === "deleted"; state.buyUnit = kind === "unconfigured" ? "pallet" : "box";
 const f = form({ warehouse_id: "warehouse" }); f.append("pilih", "material|first|1"); f.append("pilih", "output|second|2");
 await expect(buatPOdariUsulan(f)).rejects.toThrow(/satuan|Satuan/);
 expect(state.writes).toEqual([]);
});
it("normalizes chosen ingredient and output units using master factors", async () => {
 await expect(simpanResep(form({ item_id: "output", nama: "Recipe", output_qty: "2", output_unit: "box", bahan: JSON.stringify([{ item_id: "material", qty: 1.5, satuan: "kg", faktor: 1 }]) }))).rejects.toThrow(/success=/);
 expect(state.writes.find(row => row.table === "production_recipes")?.value).toMatchObject({ output_qty: 24 });
 expect(state.writes.find(row => row.table === "production_recipe_items")?.value).toEqual([{ recipe_id: "saved", item_id: "material", qty: 1500 }]);
});
it("rejects a removed output unit before saving any recipe", async () => {
 state.removed = true;
 await expect(simpanResep(form({ item_id: "output", nama: "Recipe", output_qty: "2", output_unit: "box", bahan: '[{"item_id":"material","qty":1,"satuan":"kg"}]' }))).rejects.toThrow(/satuan|Satuan/);
 expect(state.writes).toEqual([]);
});
