import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({version:null as 1|null,savedSalesperson:"groomer" as string|null,existing:false,retry:false,customer:false,balance:100,stockError:false,transportError:false,activeReadError:false,postReadError:false,checkoutError:false,lostResponse:false,paidExisting:false,inpatientOpen:false,correctionPending:false,shift:"open" as "open"|"none"|"throw",pajakThrow:false,periodeError:false,failTable:"",errorTable:"",tierAfterPoints:-1,visitWrites:[] as unknown[],pointWrites:[] as {delta:number}[],calls:[] as {name:string;params:Record<string,unknown>}[],wrapper:true,wrapperError:null as {code:string;message:string}|null,attempted:[] as string[],wrapped:[] as {name:string;params:Record<string,unknown>}[]}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/clinic-payment",async()=>await import("../clinic-payment"));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
 from(table:string){
  let id="";
  const invoice={service_pricing_version:state.version,salesperson_id:state.savedSalesperson,id:"invoice",visit_id:"visit",invoice_no:"INV-FIC",request_key:state.retry?"request":"original-key",subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:state.paidExisting?"Lunas":"Belum Lunas",metode_bayar:"Tunai",voucher_code:null,correction_pending:state.correctionPending};
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="id")id=value;return q;},is:()=>q,order:()=>q,limit:()=>q,update:(patch:{points?:number})=>{if(table==="visits")state.visitWrites.push(patch);if(table==="customers"&&patch.points!==undefined)state.balance=patch.points;return q;},insert:(row:{delta:number})=>{if(table==="point_ledger")state.pointWrites.push(row);return q;},
   maybeSingle:async()=>{if(table===state.failTable)throw Error(`read failed: ${table}`);if(table===state.errorTable)return {data:null,error:{message:`${table} unavailable`}};return {data:table==="medical_records"?{id:"record"}:table==="clinic_demo_policies"?{id:"policy",name:"DEMO",incentive_percent:5,fee_bearer:"customer",fee_rates:{Transfer:100},admin_revenue_code:"4303",admin_expense_code:"5501"}:table==="customers"?{points:state.balance,customer_categories:{is_active:true,rupiah_per_poin:10}}:table==="visits"?{branch_id:"branch",customer_id:state.customer?"customer":null,doctor_id:null,service_provider_id:"groomer"}:table==="employees"?(id==="groomer"?{id,branch_id:"branch"}:id==="foreign"?{id,branch_id:"other"}:null):table==="inpatient_records"&&state.inpatientOpen?{id:"active-inpatient"}:table==="invoices"?(state.existing||id==="invoice"?{...invoice,...(id==="old-invoice"?{id:"old-invoice"}:{})}:null):null,error:table==="invoices"&&((id==="invoice"&&state.postReadError)||(id!=="invoice"&&state.activeReadError))?{message:"Invoice read unavailable"}:null};},
   then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>(table===state.failTable?Promise.reject(Error(`read failed: ${table}`)):Promise.resolve(table===state.errorTable?{data:null,error:{message:`${table} unavailable`}}:{data:[],error:null})).then(resolve,reject)};return q;
 },
 rpc:async(name:string,params:Record<string,unknown>)=>{
  state.attempted.push(name);
  // Pembungkus "item susulan" (migrasi 20261101000000) memanggil RPC posting/koreksi
  // yang sama, dengan muatan yang sama, di dalam satu transaksi. Tiruan ini meneruskan
  // ke nama efektifnya supaya pemeriksaan lama tetap menguji muatan yang sesungguhnya,
  // dan mencatat terpisah bahwa jalurnya memang lewat pembungkus.
  const bungkus:Record<string,string>={clinic_post_invoice_with_record:"post",clinic_post_dp_and_admit_with_record:"clinic_post_dp_and_admit",clinic_edit_invoice_with_record:"clinic_edit_invoice"};
  if(name in bungkus){
   if(state.wrapperError)return {data:null,error:state.wrapperError};
   if(!state.wrapper)return {data:null,error:{code:"PGRST202",message:`Could not find the function public.${name}(${Object.keys(params).sort().join(", ")}) in the schema cache`}};
   state.wrapped.push({name,params});
   name=bungkus[name]==="post"
    ? (params.p_policy_id?"clinic_post_demo_invoice":params.p_payments?"clinic_post_split_invoice":"clinic_post_invoice")
    : bungkus[name];
  }
  state.calls.push({name,params});const posting=["clinic_post_invoice","clinic_post_split_invoice","clinic_post_demo_invoice","clinic_post_dp_and_admit"].includes(name);
  if(posting&&state.lostResponse){state.version=(params.p_invoice as {service_pricing_version?:1}).service_pricing_version??null;state.savedSalesperson=(params.p_invoice as {salesperson_id:string|null}).salesperson_id;state.lostResponse=false;state.existing=true;state.retry=true;throw Error("Response lost after commit")}
  return {data:posting&&!state.stockError?(name==="clinic_post_dp_and_admit"?{invoice_id:"invoice",inpatient_id:"stay"}:"invoice"):null,error:posting&&state.transportError?{message:"Fetch failed"}:posting&&state.stockError?{code:"P0001",message:"STOCK_SHORT: Fiction medicine"}:name==="set_visit_service_state"&&state.checkoutError?{message:"Checkout response not confirmed"}:null};},
})}));
vi.mock("@/lib/shift",()=>({getOpenShift:async()=>{if(state.shift==="throw")throw Error("Shift gagal dimuat.");return state.shift==="open"?{id:"shift"}:null;}}));
vi.mock("@/lib/tindakan",()=>({bolehBayar:()=>true,kategoriBerisiko:()=>[]}));
vi.mock("@/lib/consent-server",()=>({bacaAturanConsent:async()=>[]}));
vi.mock("@/lib/jurnal-guard",()=>({cekPeriode:async()=>state.periodeError?"Gagal memeriksa status tutup buku, coba lagi.":null}));
vi.mock("@/lib/tanggal",async()=>await import("../tanggal"));
vi.mock("@/lib/pajak",()=>({getPajakSettings:async()=>{if(state.pajakThrow)throw Error("Pajak read failed");return {};},tambahPpn:(dpp:number)=>({tax:0,total:dpp})}));
vi.mock("@/lib/rombongan-server",()=>({bacaRombongan:vi.fn()}));
vi.mock("@/lib/tagihan-klinik",()=>({nilaiBaris:(r:{qty:number;harga:number})=>r.qty*r.harga,hargaNetto:(r:{harga:number})=>r.harga,hitungPotonganKlinik:async()=>({total:0,tolakVoucher:null}),barisTagihanVisit:vi.fn(),bagiPotongan:vi.fn()}));
vi.mock("@/lib/voucher",()=>({normalizeKode:()=>"",pesanVoucherDitolak:vi.fn(),potonganVoucher:vi.fn()}));
vi.mock("@/lib/klinik-posting",async()=>await import("../klinik-posting"));
vi.mock("@/lib/poin-klinik",async()=>await import("../poin-klinik"));
vi.mock("@/lib/customer-tier",()=>({recomputeCustomerTier:vi.fn(async()=>{state.tierAfterPoints=state.pointWrites.length;return true;})}));
vi.mock("@/lib/wa-engine",()=>({kirimStrukWa:vi.fn()}));
import { bayarRombongan, bayarVisit } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";
import { bacaRombongan } from "@/lib/rombongan-server";
import { barisTagihanVisit, bagiPotongan } from "@/lib/tagihan-klinik";
function form(selected?:string){const f=new FormData();f.set("visitId","visit");f.set("requestKey","request");f.set("items",JSON.stringify([{deskripsi:"Medicine",qty:1,harga:100,satuan:"box",item_id:"item"}]));f.set("edit_reason","Correction");if(selected!==undefined)f.set("salesperson_id",selected);return f;}
beforeEach(()=>{state.version=null;state.savedSalesperson="groomer";state.stockError=false;state.transportError=false;state.activeReadError=false;state.postReadError=false;state.checkoutError=false;state.lostResponse=false;state.paidExisting=false;state.inpatientOpen=false;state.correctionPending=false;state.shift="open";state.pajakThrow=false;state.periodeError=false;state.failTable="";state.errorTable="";state.tierAfterPoints=-1;state.visitWrites=[];state.existing=false;state.retry=false;state.customer=false;state.balance=100;state.pointWrites=[];state.calls=[];state.wrapper=true;state.wrapperError=null;state.attempted=[];state.wrapped=[];});
it('binds separate invoice correction to its explicit actual invoice rather than latest stage',async()=>{state.existing=true;const f=form();f.set('target_invoice_id','old-invoice');await bayarVisit(f);expect(state.calls.find(call=>call.name==='clinic_edit_invoice')?.params.p_invoice_id).toBe('old-invoice');});
describe("DP-first explicit inpatient orchestration (unit only)",()=>{
 it("posts ordinary DP and explicit admission in ONE RPC, without a later visit write",async()=>{
  const data=form();data.set("paid_status","DP");data.set("dp_amount","60");
  data.set("admit_after_dp","1");data.set("treatment_plan","Monitoring fiktif");data.set("stay_type","sakit");
  await expect(bayarVisit(data)).resolves.toEqual({saved:true,href:"/klinik/rawat-inap/stay?success=admit"});
  expect(state.calls[0]).toMatchObject({name:"clinic_post_dp_and_admit",params:{p_treatment_plan:"Monitoring fiktif",p_stay_type:"sakit",p_invoice:{paid_status:"DP",dp_amount:60}}});
  expect(state.visitWrites).toEqual([]);
 });
 it("never silently falls back to ordinary posting when atomic DP/admission is unavailable",async()=>{
  state.transportError=true;const data=form();data.set("paid_status","DP");data.set("dp_amount","60");data.set("admit_after_dp","1");data.set("treatment_plan","Fiktif");data.set("stay_type","sakit");
  await expect(bayarVisit(data)).rejects.toThrow("?error=");
  expect(state.calls.map(c=>c.name)).toEqual(["clinic_post_dp_and_admit"]);
 });
 it.each(["treatment_plan","stay_type"])("requires explicit %s before recording money",async(field)=>{
  const data=form();data.set("paid_status","DP");data.set("admit_after_dp","1");data.set("treatment_plan","Fiktif");data.set("stay_type","sakit");data.delete(field);
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
 });
 it.each(["split_payments","demo_policy_id"])("rejects unsupported %s with inpatient intent before any money RPC",async(field)=>{
  const data=form();data.set("paid_status","DP");data.set("dp_amount","60");data.set("admit_after_dp","1");data.set("treatment_plan","Fiktif");data.set("stay_type","sakit");
  data.set(field,field==="demo_policy_id"?"policy":JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);expect(state.visitWrites).toEqual([]);
 });
 it("rejects finalize rather than silently checking out an intended inpatient",async()=>{
  const data=form();data.set("finalize","1");data.set("admit_after_dp","1");data.set("treatment_plan","Fiktif");data.set("stay_type","sakit");
  await expect(bayarVisit(data)).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
 });
});

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

describe("U07 parallel reads before posting",()=>{
 const posts=()=>state.calls.filter(c=>c.name.startsWith("clinic_post")||c.name==="clinic_edit_invoice");
 it.each([
  ["shift read error",()=>{state.shift="throw";},"Shift gagal dimuat"],
  ["closed-period read error",()=>{state.periodeError=true;},"tutup%20buku"],
  ["active invoice read error",()=>{state.activeReadError=true;},"belum%20dapat%20diverifikasi"],
  ["visit read error",()=>{state.failTable="visits";},"read failed: visits"],
  ["loyalty balance read error",()=>{state.customer=true;state.failTable="customers";},"read failed: customers"],
  ["tax settings read error",()=>{state.pajakThrow=true;},"Pajak read failed"],
  ["payment account map read error",()=>{state.failTable="payment_account_map";},"read%20failed"],
 ])("fails closed without posting on %s",async(_label,arrange,message)=>{
  arrange();const data=form("groomer");data.set("finalize","1");data.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(data)).rejects.toThrow(message);
  expect(posts()).toEqual([]);expect(state.pointWrites).toEqual([]);expect(state.visitWrites).toEqual([]);
 });
 it("keeps the first validation's message when a later prefetched read also fails",async()=>{
  // Shift check comes first; reads that now run alongside it must not replace that
  // message nor surface as unhandled rejections.
  state.shift="none";state.pajakThrow=true;state.failTable="visits";
  await expect(bayarVisit(form("groomer"))).rejects.toThrow("REDIRECT:/klinik/shift?error=");
  expect(posts()).toEqual([]);
 });
 it("records loyalty points before the response and refreshes the customer tier afterwards",async()=>{
  state.customer=true;const data=form("groomer");data.set("finalize","1");
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.pointWrites).toHaveLength(1);expect(state.tierAfterPoints).toBe(1);
 });
});

describe("U07 group payment reads",()=>{
 function groupForm(){const f=new FormData();f.set("visitId","visit");f.set("requestKey","group");return f;}
 beforeEach(()=>{
  state.customer=true;
  vi.mocked(bacaRombongan).mockResolvedValue({customerId:"customer",customerName:"Owner",baris:[{visitId:"pet-a",hewan:"Alpha",invoiceNo:null},{visitId:"pet-b",hewan:"Beta",invoiceNo:null}]} as never);
  vi.mocked(bagiPotongan).mockImplementation(((dasar:number[])=>dasar.map(()=>0)) as never);
  vi.mocked(barisTagihanVisit).mockImplementation((async(_s:unknown,visitId:string)=>[{deskripsi:`Service ${visitId}`,qty:1,harga:100,jenis:"obat",item_id:"item",satuan:"pcs"}]) as never);
 });
 it("prepares every pet together but still posts one invoice per pet in order, points per invoice, tier after",async()=>{
  await expect(bayarRombongan(groupForm())).rejects.toThrow("REDIRECT:/klinik/pembayaran/visit?success=rombongan&lunas=2");
  expect(state.calls.filter(c=>c.name.startsWith("clinic_post")).map(c=>c.params.p_request_key)).toEqual(["group:pet-a","group:pet-b"]);
  // J03: one earn row per posted invoice (ref = invoice number) so a refund of either invoice finds its points;
  // the combined earn is unchanged (Rp200 at Rp10/poin = 20 poin) and the tier is refreshed after both rows.
  expect(state.pointWrites).toMatchObject([{delta:10,ref:"INV-FIC"},{delta:10,ref:"INV-FIC"}]);expect(state.tierAfterPoints).toBe(2);
 });
 it("fails closed without posting any pet when one pet's bill cannot be read",async()=>{
  vi.mocked(barisTagihanVisit).mockImplementation((async(_s:unknown,visitId:string)=>{if(visitId==="pet-b")throw Error("bill read failed");return [{deskripsi:"A",qty:1,harga:100,jenis:"obat",item_id:"item",satuan:"pcs"}];}) as never);
  await expect(bayarRombongan(groupForm())).rejects.toThrow("bill read failed");
  expect(state.calls.filter(c=>c.name.startsWith("clinic_post"))).toEqual([]);expect(state.pointWrites).toEqual([]);
 });
});

describe("Fail closed on returned read errors (consent gate and visit)",()=>{
 const posts=()=>state.calls.filter(c=>c.name.startsWith("clinic_post")||c.name==="clinic_edit_invoice");
 it.each([
  ["medical_records","persetujuan%20tindakan%20belum%20dapat%20diverifikasi"],
  ["prescription_items","persetujuan%20tindakan%20belum%20dapat%20diverifikasi"],
  ["inpatient_records","persetujuan%20tindakan%20belum%20dapat%20diverifikasi"],
  ["consents","persetujuan%20tindakan%20belum%20dapat%20diverifikasi"],
  ["visits","Data%20kunjungan%20belum%20dapat%20dibaca"],
 ])("single payment stops before posting when %s returns {error}",async(table,message)=>{
  state.errorTable=table;const data=form("groomer");data.set("finalize","1");
  await expect(bayarVisit(data)).rejects.toThrow(message);
  expect(posts()).toEqual([]);expect(state.pointWrites).toEqual([]);expect(state.visitWrites).toEqual([]);
 });
 it.each([["medical_records"],["prescription_items"],["inpatient_records"],["consents"],["visits"]])("group payment posts nothing when %s returns {error}",async table=>{
  state.customer=true;state.errorTable=table;
  vi.mocked(bacaRombongan).mockResolvedValue({customerId:"customer",customerName:"Owner",baris:[{visitId:"pet-a",hewan:"Alpha",invoiceNo:null},{visitId:"pet-b",hewan:"Beta",invoiceNo:null}]} as never);
  vi.mocked(bagiPotongan).mockImplementation(((dasar:number[])=>dasar.map(()=>0)) as never);
  vi.mocked(barisTagihanVisit).mockImplementation((async()=>[{deskripsi:"A",qty:1,harga:100,jenis:"obat",item_id:"item",satuan:"pcs"}]) as never);
  const f=new FormData();f.set("visitId","visit");f.set("requestKey","group");
  await expect(bayarRombongan(f)).rejects.toThrow("Alpha%3A");
  expect(posts()).toEqual([]);expect(state.pointWrites).toEqual([]);
 });
});

// Andri 29 Okt (opsi B): baris yang ditambah kasir sendiri harus ikut tercatat di rekam
// medis. Yang diuji di sini hanya lapisan server action — penautannya sendiri hidup di
// RPC pembungkus (lihat scripts/test-item-susulan-full-schema-postgres.py).
describe("tagihan klinik mencatat baris tambahan kasir ke rekam medis",()=>{
 const baris=()=>state.calls.filter(c=>c.name.startsWith("clinic_post")||c.name==="clinic_edit_invoice");
 it("menerbitkan tagihan lewat pembungkus rekam medis, dengan muatan yang sama",async()=>{
  await expect(bayarVisit(form("groomer"))).resolves.toMatchObject({saved:true});
  expect(state.wrapped.map(c=>c.name)).toEqual(["clinic_post_invoice_with_record"]);
  expect(baris()).toHaveLength(1);
  expect(baris()[0].params).toMatchObject({p_visit_id:"visit",p_request_key:"request"});
  // Baris kasir berangkat tanpa tautan resep; RPC pembungkus yang mengisinya.
  expect(baris()[0].params.p_lines).toMatchObject([{description:"Medicine",prescription_item_id:null}]);
 });
 it("pembayaran campuran dan DEMO juga lewat pembungkus yang sama",async()=>{
  const campuran=form("groomer");campuran.set("finalize","1");
  campuran.set("split_payments",JSON.stringify([{method:"Tunai",amount:40},{method:"Transfer",amount:60}]));
  await expect(bayarVisit(campuran)).resolves.toMatchObject({saved:true});
  expect(state.wrapped).toHaveLength(1);
  expect(baris()[0].name).toBe("clinic_post_split_invoice");
  expect(state.wrapped[0].params.p_payments).toHaveLength(2);
 });
 it("koreksi tagihan memakai pembungkus koreksi; baris warisan tetap dikirim apa adanya",async()=>{
  state.existing=true;
  const data=form("groomer");
  data.set("items",JSON.stringify([{deskripsi:"Medicine",qty:1,harga:100,satuan:"box",item_id:"item",source_invoice_item_id:"old-line"}]));
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.wrapped.map(c=>c.name)).toEqual(["clinic_edit_invoice_with_record"]);
  expect(baris()[0].name).toBe("clinic_edit_invoice");
  expect(baris()[0].params.p_lines).toMatchObject([{source_invoice_item_id:"old-line"}]);
 });
 it("database yang belum dimigrasi tetap bisa menagih lewat RPC lama",async()=>{
  state.wrapper=false;
  await expect(bayarVisit(form("groomer"))).resolves.toMatchObject({saved:true});
  expect(state.wrapped).toEqual([]);
  expect(baris().map(c=>c.name)).toEqual(["clinic_post_invoice"]);
 });
 it("database yang belum dimigrasi tetap bisa mengoreksi tagihan",async()=>{
  state.wrapper=false;state.existing=true;
  await expect(bayarVisit(form("groomer"))).resolves.toMatchObject({saved:true});
  expect(state.wrapped).toEqual([]);
  expect(baris().map(c=>c.name)).toEqual(["clinic_edit_invoice"]);
 });
 it.each([false,true])("dependency internal 42883 ditolak tanpa fallback (koreksi=%s)",async(correction)=>{
  state.existing=correction;
  state.wrapperError={code:"42883",message:"function clinic_private.link_unrecorded_lines(uuid, text, jsonb, unknown) does not exist"};
  await expect(bayarVisit(form("groomer"))).rejects.toThrow("?error=");
  expect(state.attempted).toEqual([correction?"clinic_edit_invoice_with_record":"clinic_post_invoice_with_record"]);
  expect(baris()).toEqual([]);expect(state.pointWrites).toEqual([]);expect(state.visitWrites).toEqual([]);
 });
 it.each([false,true])("PGRST202 untuk fungsi lain tidak membolehkan fallback (koreksi=%s)",async(correction)=>{
  state.existing=correction;
  state.wrapperError={code:"PGRST202",message:"Could not find the function public.unrelated_function(p_lines) in the schema cache"};
  await expect(bayarVisit(form("groomer"))).rejects.toThrow("?error=");
  expect(state.attempted).toEqual([correction?"clinic_edit_invoice_with_record":"clinic_post_invoice_with_record"]);
  expect(baris()).toEqual([]);
 });
 it("galat posting dari pembungkus tetap menghentikan pembayaran, bukan jatuh ke RPC lama",async()=>{
  state.stockError=true;
  await expect(bayarVisit(form("groomer"))).rejects.toThrow("Stok%20tidak%20cukup");
  expect(state.wrapped).toHaveLength(1);
  expect(baris()).toHaveLength(1);
 });
});

// Item susulan sesudah kasir membuka keranjang: layar mengirim versi keranjang yang
// dibacanya; pembungkus membandingkannya di bawah kunci (CART_STALE). Lapisan uangnya
// dibuktikan di scripts/test-item-susulan-keranjang-postgres.py; di sini kontrak aksi.
describe("versi keranjang rawat jalan (dokter menambah item sesudah keranjang dibuka)",()=>{
 const VERSI="v1:0123456789abcdef0123456789abcdef";
 it("mengirim versi keranjang yang dibuka kasir ke pembungkus posting",async()=>{
  const data=form("groomer");data.set("source_version",VERSI);
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.wrapped).toHaveLength(1);
  expect(state.wrapped[0]).toMatchObject({name:"clinic_post_invoice_with_record",params:{p_cart_version:VERSI}});
 });
 it("DP & rawat inap lewat pembungkus rekam medis dengan versi yang sama",async()=>{
  const data=form();data.set("paid_status","DP");data.set("dp_amount","60");data.set("source_version",VERSI);
  data.set("admit_after_dp","1");data.set("treatment_plan","Monitoring fiktif");data.set("stay_type","sakit");
  await expect(bayarVisit(data)).resolves.toEqual({saved:true,href:"/klinik/rawat-inap/stay?success=admit"});
  expect(state.wrapped).toEqual([{name:"clinic_post_dp_and_admit_with_record",params:expect.objectContaining({p_cart_version:VERSI,p_treatment_plan:"Monitoring fiktif",p_stay_type:"sakit"})}]);
 });
 it("versi yang bukan dari database tidak dikirim sebagai versi (pembungkus menolak tertutup)",async()=>{
  const data=form("groomer");data.set("source_version","f".repeat(64));
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.wrapped[0].params).not.toHaveProperty("p_cart_version");
 });
 it("CART_STALE: pesan muat ulang, tanpa jalur lama, tanpa poin/status kunjungan",async()=>{
  state.wrapperError={code:"P0001",message:"CART_STALE: rekam medis berubah setelah keranjang dibuka; muat ulang tagihan lalu periksa ulang"};
  const data=form("groomer");data.set("finalize","1");data.set("source_version",VERSI);
  const galat=await bayarVisit(data).then(()=>null,(e:Error)=>decodeURIComponent(e.message));
  expect(galat).toContain("Rekam medis berubah setelah keranjang ini dibuka");
  expect(galat).toContain("Muat tagihan terbaru");
  expect(state.attempted).toEqual(["clinic_post_invoice_with_record"]);
  expect(state.calls).toEqual([]);expect(state.pointWrites).toEqual([]);expect(state.visitWrites).toEqual([]);
 });
 it("koreksi tagihan yang sudah terbit tidak membawa versi keranjang",async()=>{
  state.existing=true;const data=form("groomer");data.set("source_version",VERSI);
  await expect(bayarVisit(data)).resolves.toMatchObject({saved:true});
  expect(state.wrapped.map(c=>c.name)).toEqual(["clinic_edit_invoice_with_record"]);
  expect(state.wrapped[0].params).not.toHaveProperty("p_cart_version");
 });
});
