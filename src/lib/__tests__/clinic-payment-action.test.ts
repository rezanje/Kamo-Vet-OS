import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({version:null as 1|null,savedSalesperson:"groomer" as string|null,existing:false,retry:false,customer:false,balance:100,stockError:false,transportError:false,activeReadError:false,postReadError:false,checkoutError:false,lostResponse:false,paidExisting:false,inpatientOpen:false,correctionPending:false,visitWrites:[] as unknown[],pointWrites:[] as {delta:number}[],calls:[] as {name:string;params:Record<string,unknown>}[]}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/clinic-payment",async()=>await import("../clinic-payment"));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
 from(table:string){
  let id="";
  const invoice={service_pricing_version:state.version,salesperson_id:state.savedSalesperson,id:"invoice",visit_id:"visit",invoice_no:"INV-FIC",request_key:state.retry?"request":"original-key",subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:state.paidExisting?"Lunas":"Belum Lunas",metode_bayar:"Tunai",voucher_code:null,correction_pending:state.correctionPending};
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="id")id=value;return q;},is:()=>q,order:()=>q,limit:()=>q,update:(patch:{points?:number})=>{if(table==="visits")state.visitWrites.push(patch);if(table==="customers"&&patch.points!==undefined)state.balance=patch.points;return q;},insert:(row:{delta:number})=>{if(table==="point_ledger")state.pointWrites.push(row);return q;},
   maybeSingle:async()=>({data:table==="clinic_demo_policies"?{id:"policy",name:"DEMO",incentive_percent:5,fee_bearer:"customer",fee_rates:{Transfer:100},admin_revenue_code:"4303",admin_expense_code:"5501"}:table==="customers"?{points:state.balance,customer_categories:{is_active:true,rupiah_per_poin:10}}:table==="visits"?{branch_id:"branch",customer_id:state.customer?"customer":null,doctor_id:null,service_provider_id:"groomer"}:table==="employees"?(id==="groomer"?{id,branch_id:"branch"}:id==="foreign"?{id,branch_id:"other"}:null):table==="inpatient_records"&&state.inpatientOpen?{id:"active-inpatient"}:table==="invoices"?(state.existing||id==="invoice"?invoice:null):null,error:table==="invoices"&&((id==="invoice"&&state.postReadError)||(id!=="invoice"&&state.activeReadError))?{message:"Invoice read unavailable"}:null}),
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;
 },
 rpc:async(name:string,params:Record<string,unknown>)=>{state.calls.push({name,params});const posting=["clinic_post_invoice","clinic_post_split_invoice","clinic_post_demo_invoice"].includes(name);
  if(posting&&state.lostResponse){state.version=(params.p_invoice as {service_pricing_version?:1}).service_pricing_version??null;state.savedSalesperson=(params.p_invoice as {salesperson_id:string|null}).salesperson_id;state.lostResponse=false;state.existing=true;state.retry=true;throw Error("Response lost after commit")}
  return {data:posting&&!state.stockError?"invoice":null,error:posting&&state.transportError?{message:"Fetch failed"}:posting&&state.stockError?{code:"P0001",message:"STOCK_SHORT: Fiction medicine"}:name==="set_visit_service_state"&&state.checkoutError?{message:"Checkout response not confirmed"}:null};},
})}));
vi.mock("@/lib/shift",()=>({getOpenShift:async()=>({id:"shift"})}));
vi.mock("@/lib/tindakan",()=>({bolehBayar:()=>true,kategoriBerisiko:()=>[]}));
vi.mock("@/lib/consent-server",()=>({bacaAturanConsent:async()=>[]}));
vi.mock("@/lib/jurnal-guard",()=>({cekPeriode:async()=>null}));
vi.mock("@/lib/tanggal",async()=>await import("../tanggal"));
vi.mock("@/lib/pajak",()=>({getPajakSettings:async()=>({}),tambahPpn:(dpp:number)=>({tax:0,total:dpp})}));
vi.mock("@/lib/rombongan-server",()=>({bacaRombongan:vi.fn()}));
vi.mock("@/lib/tagihan-klinik",()=>({nilaiBaris:(r:{qty:number;harga:number})=>r.qty*r.harga,hargaNetto:(r:{harga:number})=>r.harga,hitungPotonganKlinik:async()=>({total:0,tolakVoucher:null}),barisTagihanVisit:vi.fn(),bagiPotongan:vi.fn()}));
vi.mock("@/lib/voucher",()=>({normalizeKode:()=>"",pesanVoucherDitolak:vi.fn(),potonganVoucher:vi.fn()}));
vi.mock("@/lib/klinik-posting",async()=>await import("../klinik-posting"));
vi.mock("@/lib/poin-klinik",async()=>await import("../poin-klinik"));
vi.mock("@/lib/customer-tier",()=>({recomputeCustomerTier:vi.fn()}));
vi.mock("@/lib/wa-engine",()=>({kirimStrukWa:vi.fn()}));
import { bayarVisit } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";
function form(selected?:string){const f=new FormData();f.set("visitId","visit");f.set("requestKey","request");f.set("items",JSON.stringify([{deskripsi:"Medicine",qty:1,harga:100,satuan:"box",item_id:"item"}]));f.set("edit_reason","Correction");if(selected!==undefined)f.set("salesperson_id",selected);return f;}
beforeEach(()=>{state.version=null;state.savedSalesperson="groomer";state.stockError=false;state.transportError=false;state.activeReadError=false;state.postReadError=false;state.checkoutError=false;state.lostResponse=false;state.paidExisting=false;state.inpatientOpen=false;state.correctionPending=false;state.visitWrites=[];state.existing=false;state.retry=false;state.customer=false;state.balance=100;state.pointWrites=[];state.calls=[];});
describe("clinic payment salesperson boundary",()=>{
 it("posts mixed cash and transfer as a single atomic RPC", async()=>{
  const data=form("groomer");data.set("finalize","1");data.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.calls[0]).toMatchObject({name:"clinic_post_split_invoice",params:{p_payments:[{method:"Tunai",amount:40,kas_code:"1101"},{method:"Transfer",amount:60,kas_code:"1102"}]}});
 });
 it("rejects a split that does not cover the server invoice total", async()=>{
  const data=form("groomer");data.set("finalize","1");data.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:59}]));
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
 });
 it("rejects malformed mixed payments before invoice posting", async()=>{
  const data=form();data.set("split_payments","{}");
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
 });
 it("rejects split payment changes during correction", async()=>{
  state.existing=true;const data=form();data.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
 });
 it("replays a mixed creation request without changing to the edit RPC", async()=>{
  state.existing=true;state.retry=true;const data=form("groomer");data.set("finalize","1");data.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});expect(state.calls[0].name).toBe("clinic_post_split_invoice");
 });
 it("preserves the default case attribution and selected medicine unit",async()=>{
  await expect(bayarVisit(form("groomer"))).resolves.toEqual({saved:true,href:"/klinik/pembayaran/visit?success=bayar"});
  expect(state.calls[0]).toMatchObject({name:"clinic_post_invoice",params:{p_invoice:{salesperson_id:"groomer"},p_lines:[{unit:"box"}]}});
 });
 it("ignores a forged cross-branch header employee and keeps the default case attribution",async()=>{
  await expect(bayarVisit(form("foreign"))).resolves.toMatchObject({saved:true});expect(state.calls[0]).toMatchObject({params:{p_invoice:{salesperson_id:"groomer"}}});
 });
 it("does not change salesperson attribution on an existing invoice",async()=>{
  state.existing=true;await expect(bayarVisit(form("foreign"))).resolves.toEqual({saved:true,href:"/klinik/pembayaran/visit?success=edit"});
  expect(state.calls[0].name).toBe("clinic_edit_invoice");expect(state.calls[0].params.p_invoice).not.toHaveProperty("salesperson_id");
 });
 it("replays a creation key after a committed invoice response is lost",async()=>{
  state.existing=true;state.retry=true;
  await expect(bayarVisit(form("groomer"))).resolves.toEqual({saved:true,href:"/klinik/pembayaran/visit?success=bayar"});
  expect(state.calls[0].name).toBe("clinic_post_invoice");expect(state.calls[0].params.p_request_key).toBe("request");
 });

 it("does not award loyalty twice when a completed creation request is replayed",async()=>{
  state.customer=true;const data=form("groomer");data.set("finalize","1");
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.balance).toBe(110);expect(state.pointWrites).toEqual([expect.objectContaining({delta:10})]);
  state.existing=true;state.retry=true;
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.balance).toBe(110);expect(state.pointWrites).toHaveLength(1);
 });

 it("sends base mixed payments and selected staff to the DEMO atomic wrapper",async()=>{
  const data=form("groomer");data.set("finalize","1");data.set("demo_policy_id","policy");data.set("demo_employee_ids",'["groomer"]');
  data.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.calls[0]).toMatchObject({name:"clinic_post_demo_invoice",params:{p_policy_id:"policy",p_employee_ids:["groomer"],p_invoice:{total:100},p_payments:[{amount:40},{amount:60}]}});
 });
 it("rejects single DEMO payment that omits the customer fee",async()=>{
  const data=form("groomer");data.set("finalize","1");data.set("demo_policy_id","policy");data.set("demo_employee_ids",'["groomer"]');data.set("metode_bayar","Transfer");data.set("demo_received","100");
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
  data.set("demo_received","101");await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});expect(state.calls[0].name).toBe("clinic_post_demo_invoice");
 });
 it("does not allow an empty recipient set",async()=>{
  const data=form("groomer");data.set("finalize","1");data.set("demo_policy_id","policy");data.set("demo_employee_ids","[]");data.set("demo_received","100");
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
 });

});

describe("K08 confirmed posting boundaries",()=>{
 it("keeps stock failure unposted and does not advance visit/payment status",async()=>{
  state.stockError=true;const data=form();data.set("finalize","1");await expect(bayarVisit(data)).rejects.toThrow("Stok%20tidak%20cukup");expect(state.calls.map(c=>c.name)).toEqual(["clinic_post_invoice"]);expect(state.visitWrites).toEqual([]);
 });
 it("does not create or edit when active invoice lookup is unknown",async()=>{
  state.activeReadError=true;await expect(bayarVisit(form())).rejects.toThrow("belum%20dapat%20diverifikasi");expect(state.calls).toEqual([]);
 });
 it("distinguishes a confirmed committed invoice from a failed read-back",async()=>{
  state.postReadError=true;await expect(bayarVisit(form())).rejects.toThrow("Invoice%20sudah%20tersimpan");
 });
 it("does not issue a separate checkout after confirmed atomic paid creation or its replay",async()=>{
  const data=form();data.set("finalize","1");await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  state.existing=true;state.retry=true;await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.calls.map(c=>c.name)).toEqual(["clinic_post_invoice","clinic_post_invoice"]);expect(state.visitWrites).toEqual([]);
 });
 it("replays a lost posting response with the same creation key rather than creating a correction",async()=>{
  state.lostResponse=true;const data=form();data.set("finalize","1");await expect(bayarVisit(data)).rejects.toThrow("Response lost after commit");await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  const posts=state.calls.filter(c=>c.name.startsWith("clinic_post"));expect(posts).toHaveLength(2);expect(posts[0].params).toEqual(posts[1].params);expect(state.calls.some(c=>c.name==="clinic_edit_invoice")).toBe(false);
 });
});

it('reports an unconfirmed RPC transport outcome without asserting that no payment exists',async()=>{
 state.transportError=true;await expect(bayarVisit(form())).rejects.toThrow('Hasil%20pembayaran%20belum%20dapat%20dipastikan');expect(state.calls.map(c=>c.name)).toEqual(['clinic_post_invoice']);
});
