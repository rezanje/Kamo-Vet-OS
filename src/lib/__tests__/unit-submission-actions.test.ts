import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ writes: [] as string[], inactive: false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "PO.TEST" }) }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/harga-cabang", () => ({
  loadHargaCabang: async () => new Map(),
  hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price,
  applyHargaCabang: (units: unknown[]) => units,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
  from(table: string) {
    let activeOnly = false;
    const rows = () => table === "items" ? (activeOnly && state.inactive ? [] : [{ id: "a", name: "Medicine", nama: "Medicine", unit: "pcs", sell_price: 100, buy_price: 50, item_type: "Persediaan", is_active: !state.inactive }]) : [];
    const single = () => ({ data: table === "warehouses" ? { id: "warehouse", branch_id: "branch" } : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" } : { id: "po" }, error: null });
    const query = {
      select: () => query, in: () => query, order: () => query, range: () => query,
      eq: (column: string, value: unknown) => { if (column === "is_active" && value === true) activeOnly = true; return query; },
      insert: () => { state.writes.push(table); return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { buatPO } from "../../app/(app)/pembelian/actions";
import { buatFakturLangsung } from "../../app/(app)/pembelian/faktur/langsung/actions";
import { checkoutSale } from "../../app/(app)/pos/transaksi/actions";
import { checkoutKasir } from "../../app/kasir/checkout";
function form(values: Record<string, string>) { const input = new FormData(); Object.entries(values).forEach(([key, value]) => input.set(key, value)); return input; }
beforeEach(() => { state.writes.length = 0; state.inactive = false; });
it.each([false, true])("rejects invalid PO units/inactive masters before inserting the header (inactive=%s)", async inactive => {
  state.inactive = inactive;
  await expect(buatPO(form({ branch_id: "branch", to_warehouse_id: "warehouse", items: JSON.stringify([{ item_id: "a", nama: "Medicine", qty: 2, harga_beli: 1000, satuan: "removed-box" }]) }))).rejects.toThrow(/Satuan|barang/);
  expect(state.writes).toEqual([]);
});
it.each(["direct", "pos", "cashier"])("rejects an explicitly removed unit before writing a %s transaction", async kind => {
  const row = { item_id: "a", nama: "Medicine", qty: 2, harga: 1000, satuan: "removed-box" };
  const action = kind === "direct" ? buatFakturLangsung : kind === "pos" ? checkoutSale : checkoutKasir;
  await expect(action(form({ supplier_id: "supplier", warehouse_id: "warehouse", branchId: "branch", customerId: "customer", salespersonId: "seller", metode: "Tunai", items: JSON.stringify([row]), cart: JSON.stringify([row]) }))).rejects.toThrow(/Satuan/);
  expect(state.writes).toEqual([]);
});
