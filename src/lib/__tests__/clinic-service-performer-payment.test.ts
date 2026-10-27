import { beforeEach, expect, it, vi } from "vitest";
import type {PromoHitung} from "../promo-hitung";
const state=vi.hoisted(()=>({version:null as 1|null,savedSalesperson:"groomer" as string|null,defaultEligible:true,promos:[] as PromoHitung[],categoryPercent:0,existing:false,retry:false,customer:false,balance:100,stockError:false,transportError:false,activeReadError:false,postReadError:false,checkoutError:false,lostResponse:false,paidExisting:false,inpatientOpen:false,correctionPending:false,visitWrites:[] as unknown[],pointWrites:[] as {delta:number}[],calls:[] as {name:string;params:Record<string,unknown>}[]}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/clinic-payment",async()=>await import("../clinic-payment"));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
 from(table:string){
  let id="";
  const invoice={service_pricing_version:state.version,salesperson_id:state.savedSalesperson,id:"invoice",visit_id:"visit",invoice_no:"INV-FIC",request_key:state.retry?"request":"original-key",subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:state.paidExisting?"Lunas":"Belum Lunas",metode_bayar:"Tunai",voucher_code:null,correction_pending:state.correctionPending};
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="id")id=value;return q;},is:()=>q,order:()=>q,limit:()=>q,update:(patch:{points?:number})=>{if(table==="visits")state.visitWrites.push(patch);if(table==="customers"&&patch.points!==undefined)state.balance=patch.points;return q;},insert:(row:{delta:number})=>{if(table==="point_ledger")state.pointWrites.push(row);return q;},
   maybeSingle:async()=>({data:table==="clinic_demo_policies"?{id:"policy",name:"DEMO",incentive_percent:5,fee_bearer:"customer",fee_rates:{Transfer:100},admin_revenue_code:"4303",admin_expense_code:"5501"}:table==="customers"?{points:state.balance,customer_categories:{is_active:true,rupiah_per_poin:10,diskon_persen:state.categoryPercent}}:table==="visits"?{branch_id:"branch",customer_id:state.customer?"customer":null,doctor_id:null,service_provider_id:"groomer"}:table==="employees"?(id==="groomer"&&state.defaultEligible?{id,branch_id:"branch"}:id==="foreign"?{id,branch_id:"other"}:null):table==="inpatient_records"&&state.inpatientOpen?{id:"active-inpatient"}:table==="invoices"?(state.existing||id==="invoice"?invoice:null):null,error:table==="invoices"&&((id==="invoice"&&state.postReadError)||(id!=="invoice"&&state.activeReadError))?{message:"Invoice read unavailable"}:null}),
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
vi.mock("@/lib/tagihan-klinik",async()=>await import("../tagihan-klinik"));
vi.mock("@/lib/promo-hitung",async()=>({...await vi.importActual("../promo-hitung"),loadPromoAktif:async()=>state.promos}));
vi.mock("@/lib/harga-golongan",async()=>({...await vi.importActual("../harga-golongan"),loadAturanDiskon:async()=>[],loadInfoBarang:async()=>new Map()}));
vi.mock("@/lib/voucher",()=>({normalizeKode:()=>"",pesanVoucherDitolak:vi.fn(),potonganVoucher:vi.fn()}));
vi.mock("@/lib/klinik-posting",async()=>await import("../klinik-posting"));
vi.mock("@/lib/poin-klinik",async()=>await import("../poin-klinik"));
vi.mock("@/lib/customer-tier",()=>({recomputeCustomerTier:vi.fn()}));
vi.mock("@/lib/wa-engine",()=>({kirimStrukWa:vi.fn()}));
import { bayarVisit } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";
function form(selected?:string){const f=new FormData();f.set("visitId","visit");f.set("requestKey","request");f.set("items",JSON.stringify([{deskripsi:"Medicine",qty:1,harga:100,satuan:"box",item_id:"item"}]));f.set("edit_reason","Correction");if(selected!==undefined)f.set("salesperson_id",selected);return f;}
beforeEach(()=>{state.version=null;state.savedSalesperson="groomer";state.defaultEligible=true;state.promos=[];state.categoryPercent=0;state.stockError=false;state.transportError=false;state.activeReadError=false;state.postReadError=false;state.checkoutError=false;state.lostResponse=false;state.paidExisting=false;state.inpatientOpen=false;state.correctionPending=false;state.visitWrites=[];state.existing=false;state.retry=false;state.customer=false;state.balance=100;state.pointWrites=[];state.calls=[];});

it('carries independent performer IDs and existing case attribution through one posting call, ignoring submitted names and header employee',async()=>{
 const data=form('foreign');data.set('items',JSON.stringify([
  {deskripsi:'Jasa',qty:1,harga:50,jenis:'jasa',item_id:'service',service_performers:{doctor_id:'doctor-a',staff_id:null,doctor_name:'Forged'}},
  {deskripsi:'Jasa',qty:1,harga:50,jenis:'jasa',item_id:'service',service_performers:{doctor_id:null,staff_id:'staff-b'}},
  {deskripsi:'Obat',qty:1,harga:10,jenis:'obat',service_performers:{doctor_id:'doctor-a',staff_id:'staff-b'}},
 ]));
 await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls).toHaveLength(1);
 expect(state.calls[0]).toMatchObject({name:'clinic_post_invoice',params:{p_invoice:{salesperson_id:'groomer'},p_lines:[
  expect.objectContaining({service_performers:{doctor_id:'doctor-a',staff_id:null}}),
  expect.objectContaining({service_performers:{doctor_id:null,staff_id:'staff-b'}}),
  expect.not.objectContaining({service_performers:expect.anything()}),
 ]}});
 expect(JSON.stringify(state.calls)).not.toContain('Forged');
});
it('preserves unrecorded legacy source attribution and explicit empty new-service attribution',async()=>{
 const data=form();data.set('items',JSON.stringify([
  {deskripsi:'Lama',qty:1,harga:50,jenis:'jasa',prescription_item_id:'prescription',service_performers:null},
  {deskripsi:'Baru',qty:1,harga:50,jenis:'jasa',service_performers:{doctor_id:null,staff_id:null}},
 ]));await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls[0].params.p_lines).toEqual([
  expect.not.objectContaining({service_performers:expect.anything()}),
  expect.objectContaining({service_performers:{doctor_id:null,staff_id:null}}),
 ]);
});

it('S01 forwards a cashier-assigned performer on an unassigned recorded service source to the posting call',async()=>{
 const data=form();data.set('items',JSON.stringify([
  {deskripsi:'Jasa dari rekam medis',qty:1,harga:50,jenis:'jasa',item_id:'service',prescription_item_id:'prescription',service_performers:{doctor_id:null,staff_id:'staff-b',staff_name:'Forged'}},
 ]));await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls[0].params.p_lines).toEqual([
  expect.objectContaining({prescription_item_id:'prescription',service_performers:{doctor_id:null,staff_id:'staff-b'}}),
 ]);
 expect(JSON.stringify(state.calls)).not.toContain('Forged');
});

it('uses the exact existing invoice line ID for snapshot inheritance during correction',async()=>{
 state.existing=true;const data=form();data.set('items',JSON.stringify([{deskripsi:'Jasa manual historis',qty:1,harga:100,jenis:'jasa',source_invoice_item_id:'source-line',service_performers:{doctor_id:'doctor-old',staff_id:null,doctor_name:'Nama Lama'}}]));
 await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls[0]).toMatchObject({name:'clinic_edit_invoice',params:{p_lines:[expect.objectContaining({source_invoice_item_id:'source-line',service_performers:{doctor_id:'doctor-old',staff_id:null}})]}});
});
it('does not accept a claimed historical invoice source when creating a new invoice',async()=>{
 const data=form();data.set('items',JSON.stringify([{deskripsi:'Jasa',qty:1,harga:100,jenis:'jasa',source_invoice_item_id:'foreign-line',service_performers:{doctor_id:'doctor-a',staff_id:null}}]));
 await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect((state.calls[0].params.p_lines as Record<string,unknown>[])[0].source_invoice_item_id??null).toBeNull();
});

it('replays pre-performer invoice lines with no added null keys after a lost response',async()=>{
 const data=form();data.set('items',JSON.stringify([{deskripsi:'Jasa lama',qty:1,harga:100,jenis:'jasa',service_performers:null}]));state.lostResponse=true;
 await expect(bayarVisit(data)).rejects.toThrow('Response lost after commit');
 await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls[0].params).toEqual(state.calls[1].params);
 expect(state.calls[0].params.p_invoice).toMatchObject({salesperson_id:'groomer'});
 expect(state.calls[0].params.p_lines).toEqual([{description:'Jasa lama',qty:1,price:100,kind:'jasa',item_id:null,unit:null,prescription_item_id:null,recipe_id:null,discount_percent:0}]);
});

const cappedPromo:PromoHitung={id:'cap',name:'Cap one',itemIds:['service'],minQty:1,maxQty:1,kelipatan:false,autoApply:true,discountType:'percent',discountValue:20};
function repeatedService(price=100){const data=form();data.set('items',JSON.stringify([{deskripsi:'Jasa',qty:1,harga:price,jenis:'jasa',item_id:'service',satuan:'jasa'},{deskripsi:'Jasa',qty:1,harga:price,jenis:'jasa',item_id:'service',satuan:'jasa'}]));return data;}
it.each([{kind:'promo',discount:40,total:160},{kind:'category',discount:66,total:132}])('replays the committed legacy $kind amounts and header shape exactly',async({kind,discount,total})=>{
 state.existing=true;state.retry=true;state.savedSalesperson='inactive-original';state.defaultEligible=false;
 if(kind==='promo')state.promos=[cappedPromo];else{state.customer=true;state.categoryPercent=33;}
 const data=repeatedService(kind==='promo'?100:99);data.set('salesperson_id','inactive-original');
 await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls[0].params.p_invoice).toMatchObject({discount,total,salesperson_id:'inactive-original'});
 expect(state.calls[0].params.p_invoice).not.toHaveProperty('service_pricing_version');
 for(const line of state.calls[0].params.p_lines as Record<string,unknown>[]){expect(line).not.toHaveProperty('service_performers');expect(line).not.toHaveProperty('source_invoice_item_id');}
});
it('new version one groups legacy-looking rows and replays the same header after a lost response',async()=>{
 state.promos=[cappedPromo];state.lostResponse=true;const data=repeatedService();
 await expect(bayarVisit(data)).rejects.toThrow('Response lost after commit');
 state.defaultEligible=false;
 await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
 expect(state.calls[0].params).toEqual(state.calls[1].params);
 expect(state.calls[0].params.p_invoice).toMatchObject({discount:20,total:180,service_pricing_version:1,salesperson_id:'groomer'});
});
it('rejects an explicitly changed replay actor instead of silently using the sealed employee',async()=>{
 state.existing=true;state.retry=true;state.savedSalesperson='inactive-original';
 await expect(bayarVisit(form('groomer'))).rejects.toThrow('?error=');expect(state.calls).toEqual([]);
});
