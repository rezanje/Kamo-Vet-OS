import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ snapshots: [] as Record<string, unknown>[], issues: [] as Record<string, unknown>[], lines: [] as Record<string, unknown>[], stockComponents: false, failPage: -1, failServiceInsert:false }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-TEST" }) }));
vi.mock("@/lib/inventory", () => ({ stockOut: async (_db: unknown, values: Record<string, unknown>) => { state.issues.push(values); return { cost: 13.70295 }; } }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/customer-tier", () => ({ recomputeCustomerTier: async () => {} }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: async () => "1101" }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({}), splitPpnInklusif: () => ({}) }));
vi.mock("@/lib/penjualan-jurnal", () => ({ jurnalPenjualanInklusif: () => [] }));
vi.mock("@/lib/promo-hitung", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [] }));
vi.mock("@/lib/satuan", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/satuan")>(),
  loadUnitOptions: async (_client: unknown, ids: string[]) => new Map(ids.map(id => [id, [{ unit: "pcs", factor: 1, sell_price: 1000, buy_price: 0 }]])),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "cashier" } } }) },
  rpc: async (_name: string, values: { p_sale_id: string }) => ({ data: { sale_id: values.p_sale_id, finalized: true }, error: null }),
  from(table: string) {
    let lookup = false; let costPatch:Record<string,unknown>|null=null; let targetId=""; let insertError=false;
    const group = { id: "group", code: "GRUP", name: "Paket", nama: "Paket", unit: "pcs", item_type: "Grup", sell_price: 1000, min_sell_qty: 1, is_active: true };
    const components = Array.from({ length: state.stockComponents ? 2 : 1002 }, (_, index) => ({
      id: `component-${index}`, code: `C-${index}`, name: `Jasa ${index}`, item_type: state.stockComponents ? "Persediaan" : "Jasa", is_active: true,
    }));
    let rows: Record<string, unknown>[] = table === "items" ? [group, {id:"service",nama:"Jasa",unit:"pcs",item_type:"Jasa",sell_price:1000,is_active:true,min_sell_qty:1}, ...components]
      : table === "item_group_components" ? components.map((component, index) => ({
        id: `recipe-${index}`, group_item_id: "group", component_item_id: component.id, qty: state.stockComponents ? 0.111 : 1, unit: "pcs", factor: 1, sort_order: index, component,
      })) : [];
    let from = 0; let to = 999; let count = false;
    const single = () => ({ data: table === "sales" && lookup ? null : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? (state.stockComponents ? { id: "warehouse" } : null) : { id: table === "sales" ? "sale" : (state.lines.at(-1)?.id ?? "sale-item") }, error: insertError ? {message:"service performer changed before insert"} : null });
    const query = {
      select: (_fields: string, options?: { count: string }) => { lookup = _fields.includes("checkout_fingerprint"); count = options?.count === "exact"; return query; },
      eq: (key:string,value:string) => { if(key==="id") targetId=value; return query; }, lte:()=>query, order: () => query, limit: () => query,
      in: (column: string, ids: string[]) => { rows = rows.filter(row => ids.includes(row[column] as string)); return query; },
      range: (start: number, end: number) => { from = start; to = end; return query; },
      insert: (values: Record<string, unknown>[] | Record<string, unknown>) => { if (table === "sale_item_group_components" && Array.isArray(values)) state.snapshots.push(...values); if (table === "sale_items" && !Array.isArray(values)) { insertError=state.failServiceInsert&&values.item_id==="service";if(!insertError)state.lines.push(values); } return query; },
      update: (values: Record<string, unknown>) => { costPatch=values;return query; }, delete: () => query,
      maybeSingle: async () => single(), single: async () => single(),
      then: (resolve: (value: unknown) => unknown) => { if(table==="sale_items"&&costPatch){const target=state.lines.find(row=>row.id===targetId);if(target)Object.assign(target,costPatch);} return Promise.resolve({ data: rows.slice(from, to + 1), count: count ? rows.length : null,
        error: table === "item_group_components" && from === state.failPage ? { message: "later group page failed" } : null }).then(resolve); },
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";

beforeEach(() => { state.snapshots = []; state.issues = []; state.lines = []; state.stockComponents = false; state.failPage = -1; state.failServiceInsert=false; });
function form() {
  const data = new FormData();
  Object.entries({ customerId: "customer", salespersonId: "seller", metode: "Debit", operationalShiftId: "shift", checkout_key: "checkout-identity",
    cart: JSON.stringify([{ item_id: "group", nama: "Paket", qty: 1, harga: 1000, satuan: "pcs" }]) }).forEach(([key, value]) => data.set(key, value));
  return data;
}
it("saves the full group breakdown and acknowledges the exact completed cashier draft", async () => {
  await expect(checkoutKasir(form())).rejects.toThrow("REDIRECT:/kasir/struk/sale?print=1&draft_done=checkout-identity");
  expect(state.snapshots).toHaveLength(1002);
  expect(state.snapshots.at(-1)?.component_item_id).toBe("component-1001");
});

it("does not issue a receipt when a later group component page cannot be verified", async () => {
  state.failPage = 500;
  const result = await checkoutKasir(form()).then(() => "success", error => error.message);
  expect(result).not.toContain("/struk/");
  expect(result).toMatch(/belum.*dimuat/);
  expect(state.snapshots).toHaveLength(0);
});

it("captures the same future parent identity for every fractional group issue and saved snapshot", async () => {
 state.stockComponents=true;
 await expect(checkoutKasir(form())).rejects.toThrow("/kasir/struk/sale");
 expect(state.issues).toHaveLength(2);expect(state.lines).toHaveLength(1);expect(state.snapshots).toHaveLength(2);
 const id=state.lines[0].id;
 expect(id).toMatch(/^[0-9a-f-]{36}$/i);
 expect(state.issues.map(issue=>issue.saleLineId)).toEqual([id,id]);
 expect(state.snapshots.map(row=>row.sale_item_id)).toEqual([id,id]);
 expect(state.issues.map(issue=>issue.qty)).toEqual([0.111,0.111]);
 expect(state.snapshots.map(row=>row.hpp)).toEqual([13.70295,13.70295]);
 expect(state.lines[0].hpp).toBeCloseTo(27.40590,8);
});

it("validates a later service snapshot before any earlier group's physical stock issue",async()=>{
 state.stockComponents=true;state.failServiceInsert=true;
 const data=form();const rows=JSON.parse(String(data.get("cart")));rows.push({item_id:"service",nama:"Jasa",qty:1,harga:1000,satuan:"pcs"});data.set("cart",JSON.stringify(rows));
 const outcome=await checkoutKasir(data).catch(error=>error.message);
 expect(outcome).toContain("service%20performer%20changed");expect(outcome).not.toContain("/struk/");expect(state.issues).toEqual([]);
});
it("preflights a missing later service performer before any header or line stock processing",async()=>{
 state.stockComponents=true;
 const data=form();const rows=JSON.parse(String(data.get("cart")));rows.push({item_id:"service",nama:"Jasa",qty:1,harga:1000,satuan:"pcs",service_performers:{doctor_id:"other-branch",staff_id:null}});data.set("cart",JSON.stringify(rows));
 const outcome=await checkoutKasir(data).catch(error=>error.message);
 expect(outcome).not.toContain("/struk/");expect(state.issues).toEqual([]);expect(state.lines).toEqual([]);
});
