import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as string[], headers: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[], finalized: [] as string[], removed: false, finalizationError: "", confirmation: true, stock: false, stockCost: 34567, pointsWrites: 0, prior: null as null | Record<string, unknown>, lostResponse: false, tierUnavailable: false, strongerLegacy: false, poolAbsent: false }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null }));
vi.mock("@/lib/penjual", () => ({ penjualValid: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => ({ nomor: "POS-SPLIT-TEST" }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => {} }));
vi.mock("@/lib/quest-hook", () => ({ processQuestProgress: async () => {} }));
vi.mock("@/lib/inventory", () => ({ stockOut: vi.fn(async () => ({ cost: 17040 })) }));
vi.mock("@/lib/harga-cabang", () => ({ loadHargaCabang: async () => new Map(), hargaCabang: (_map: unknown, _id: string, _unit: string, price: number) => price, applyHargaCabang: (options: unknown) => options }));
vi.mock("@/lib/promo-hitung", async original => ({ ...await original<typeof import("@/lib/promo-hitung")>(), loadPromoAktif: async () => [...(state.strongerLegacy ? [{id:'legacy',name:'Stronger legacy',itemIds:['item','other'],unit:'PCS',minQty:1,maxQty:null,kelipatan:false,autoApply:true,discountType:'nominal' as const,discountValue:1500,discountMode:'per_unit' as const}] : []),...(state.poolAbsent ? [] : [{id:'pool',name:'Fictional pool',itemIds:['item','other'],unit:'PCS',minQty:2,maxQty:null,kelipatan:true,autoApply:true,discountType:'nominal',discountValue:1,discountMode:'quantity_pool',quantityPool:{version:1,unit:'PCS',normal_price:20000,tiers:[{qty:6,total:110000},{qty:2,total:38000}]}}])] }));
vi.mock("@/lib/satuan", async original => ({ ...await original<typeof import("@/lib/satuan")>(), loadUnitOptions: async () => new Map(["item","other"].map(id=>[id,[{unit:"PCS",factor:1,sell_price:20000,buy_price:0}]])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, values: { p_sale_id: string }) => {
    state.calls.push(name);
    if (name === "refresh_customer_spending") { if(state.tierUnavailable) throw Error("derived statistics unavailable"); return {data:true,error:null}; }
    if (name !== "finalize_pos_sale" && name !== "cashier_post_stock_atomic" && name !== "quantity_pool_post_backoffice_atomic") throw Error(`Unexpected RPC ${name}`);
    if (state.lostResponse) {
      state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: state.headers[0]?.checkout_fingerprint, payments_finalized_at: "2026-10-15T08:00:00Z" };
      return { data: null, error: { message: "Connection lost after commit" } };
    }
    if (state.finalizationError) return { data: null, error: { message: state.finalizationError } };
    state.finalized.push(values.p_sale_id);
    if (name === "cashier_post_stock_atomic") state.items.forEach(item => { item.hpp = state.stockCost; });
    if(state.confirmation && state.prior)state.prior.payments_finalized_at="2026-10-15T08:00:00Z";
    return { data: state.confirmation ? { sale_id: values.p_sale_id, journal_id: "journal", finalized: true, ...(name !== "finalize_pos_sale" ? { checked: true } : {}) } : null, error: null };
  },
  from(table: string) {
    let lookup = false;
    let lineUpdate: Record<string, unknown> | null = null;
    let data: unknown = table === "items" ? ["item","other"].map(id=>({id,code:id==="item"?"DRC8993374326970":"DRC8993374326987",nama:id,name:id,unit:"PCS",item_type:"Persediaan",sell_price:20000,buy_price:0,min_sell_qty:1,is_active:true}))
      : table === "stock_layers" && state.stock ? ["item","other"].map(id=>({id:`layer:${id}`,item_id:id,qty_left:100,unit_cost:state.stockCost,exp_date:null,tanggal:"2026-10-15",created_at:"2026-10-15T00:00:00Z"})) : [];
    const single = () => ({ data: table === "sales" && lookup ? state.prior : table === "cashier_shifts" ? { id: "shift", branch_id: "branch" }
      : table === "customers" ? { points: 0, total_spending: 0, category_id: null, customer_categories: null }
        : table === "warehouses" ? (state.stock ? { id: "warehouse" } : null) : { id: table === "sales" ? "sale" : "line" }, error: null });
    const query = {
      select: (fields: string) => { lookup = fields.includes("checkout_fingerprint"); return query; }, eq: (key: string, value: unknown) => { if (table === "sale_items" && key === "id" && lineUpdate) state.items.filter(item => item.id === value).forEach(item => Object.assign(item, lineUpdate)); return query; }, in: () => query, gt: () => query, lte: () => query, not: () => query, order: () => query, range: () => query, limit: () => query,
      insert: (value: Record<string, unknown>) => { if (table === "sales") { state.headers.push(value); data = value; state.prior = { id: "sale", no_struk: "POS-SPLIT-TEST", checkout_fingerprint: value.checkout_fingerprint, payments_finalized_at: null }; } if (table === "sale_items") state.items.push({ id: "line", ...value }); if (table === "point_ledger") state.pointsWrites++; return query; },
      update: (value: Record<string, unknown>) => { lineUpdate = value; return query; }, delete: () => { if (table === "sales") { state.removed = true; state.prior = null; } return query; },
      single: async () => single(), maybeSingle: async () => single(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, count: Array.isArray(data) ? data.length : 0, error: null }).then(resolve),
    };
    return query;
  },
}) }));
import { checkoutKasir } from "@/app/kasir/checkout";
import { checkoutSale } from "@/app/(app)/pos/transaksi/actions";
import { stockOut } from "@/lib/inventory";

beforeEach(() => { vi.clearAllMocks(); state.calls=[]; state.headers = []; state.items = []; state.finalized = []; state.removed = false; state.finalizationError = ""; state.confirmation = true; state.stock = false; state.stockCost = 34567; state.pointsWrites = 0; state.prior = null; state.lostResponse = false; state.tierUnavailable = false; state.strongerLegacy = false; state.poolAbsent = false; });

function form(qty:number, quantities=[qty-1,1]) {
 const data=new FormData();
 Object.entries({branchId:'branch',customerId:'customer',metode:'Tunai',bayar:'500000',operationalShiftId:'shift',checkout_key:'quantity-pool-action',
 cart:JSON.stringify(quantities.map((q,index)=>({item_id:index%2?'other':'item',nama:'Wrong caller name',qty:q,harga:1,satuan:'PCS',promo_discount:999999,officialPrice:1})))}).forEach(([k,v])=>data.set(k,v));
 return data;
}
it('cashier preserves existing nominal manual precedence even when the caller omitted its type',async()=>{
 state.stock=true;state.stockCost=17040;
 const input=form(2);const cart=JSON.parse(String(input.get('cart')));
 cart[0].item_discount_type=null;cart[0].item_discount_value=1000;
 input.set('cart',JSON.stringify(cart));
 const outcome=await checkoutKasir(input).then(()=>'',e=>e.message);
 expect(outcome).toContain('/struk/sale');
 expect(state.headers[0]).toMatchObject({total:39000,discount:1000});
 expect(state.items.map(i=>[i.promo_id,i.promo_discount])).toEqual([[null,0],[null,0]]);
});
it.each([["cashier",checkoutKasir],["backoffice",checkoutSale]] as const)('%s recalculates mixed variants 2PCS=38000 with fresh official price evidence',async(_name,action)=>{
 state.stock=true;state.stockCost=17040;
 const outcome=await action(form(2)).then(()=>'',e=>e.message);
 expect(outcome).toContain('/struk/sale');
 expect(state.headers[0]).toMatchObject({subtotal:40000,total:38000,discount:2000});
 expect(state.items.map(i=>[i.promo_id,i.promo_discount,i.source_position])).toEqual([['pool',1000,0],['pool',1000,1]]);
 expect(state.items.map(i=>i.quantity_pool_claim)).toEqual([true,true]);
 if(_name==='backoffice') {
  expect(state.calls.filter(n=>n==='quantity_pool_post_backoffice_atomic'||n==='finalize_pos_sale')).toEqual(['quantity_pool_post_backoffice_atomic']);
  expect(stockOut).not.toHaveBeenCalled();
 }
});

it.each(['error','unconfirmed'] as const)('backoffice %s atomic result never falls back to separate stock or finalization',async(kind)=>{
 state.stock=true;state.stockCost=17040;
 if(kind==='error') state.finalizationError='QUANTITY_POOL_TOTAL: stale quote';else state.confirmation=false;
 const outcome=await checkoutSale(form(2)).then(()=>'',e=>e.message);
 expect(outcome).not.toContain('/struk/');
 expect(state.removed).toBe(true);
 expect(stockOut).not.toHaveBeenCalled();
 expect(state.calls).toContain('quantity_pool_post_backoffice_atomic');
 expect(state.calls).not.toContain('finalize_pos_sale');
});
it.each(['stronger legacy','pool absent at quote'] as const)('backoffice %s still uses atomic boundary for reviewed target codes',async(kind)=>{
 state.stock=true;state.stockCost=17040;
 state.strongerLegacy=kind==='stronger legacy';state.poolAbsent=kind==='pool absent at quote';
 state.finalizationError='QUANTITY_POOL_TOTAL: master changed before finalization';
 const outcome=await checkoutSale(form(2)).then(()=>'',e=>e.message);
 expect(state.items.every(i=>i.quantity_pool_claim===false)).toBe(true);
 expect(state.headers[0]).toMatchObject({total:kind==='stronger legacy'?37000:40000});
 expect(state.calls).toContain('quantity_pool_post_backoffice_atomic');
 expect(stockOut).not.toHaveBeenCalled();
 expect(state.calls).not.toContain('finalize_pos_sale');
 expect(outcome).not.toContain('/struk/');
 expect(state.removed).toBe(true);
});

it('backoffice lost atomic response resumes exact finalized receipt before any cleanup',async()=>{
 state.stock=true;state.stockCost=17040;state.lostResponse=true;
 const outcome=await checkoutSale(form(2)).then(()=>'',e=>e.message);
 expect(outcome).toContain('/pos/struk/sale');
 expect(state.removed).toBe(false);
 expect(stockOut).not.toHaveBeenCalled();
 expect(state.calls.filter(n=>n==='quantity_pool_post_backoffice_atomic')).toHaveLength(1);
});

it.each([
 {qty:6,quantities:[5,1],discounts:[8333,1667],total:110000},
 {qty:8,quantities:[5,3],discounts:[7500,4500],total:148000},
 {qty:7,quantities:[3,3,1],discounts:[4286,4286,1428],total:130000},
].flatMap(c=>[{...c,name:'cashier',action:checkoutKasir},{...c,name:'backoffice',action:checkoutSale}]))('$name quantity $qty matches independent PG source-position allocation',async({action,qty,quantities,discounts,total})=>{
 state.stock=true;state.stockCost=17040;
 const outcome=await action(form(qty,quantities)).then(()=>'',e=>e.message);
 expect(outcome).toContain('/struk/sale');
 expect(state.headers[0]).toMatchObject({total});
 expect(state.items.map(i=>i.promo_discount)).toEqual(discounts);
 expect(state.items.map(i=>i.source_position)).toEqual(quantities.map((_q,i)=>i));
});
