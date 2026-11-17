import { beforeEach, describe, expect, it, vi } from "vitest";
// Versi keranjang yang dibaca server untuk pembayaran rombongan (bukan dari layar).
const keranjang=vi.hoisted(()=>({order:[] as string[],error:null as {code?:string;message:string}|null}));
const state=vi.hoisted(()=>({version:null as 1|null,savedSalesperson:"groomer" as string|null,existing:false,retry:false,customer:false,balance:100,stockError:false,transportError:false,activeReadError:false,postReadError:false,checkoutError:false,lostResponse:false,paidExisting:false,inpatientOpen:false,correctionPending:false,shift:"open" as "open"|"none"|"throw",pajakThrow:false,periodeError:false,failTable:"",errorTable:"",tierAfterPoints:-1,visitWrites:[] as unknown[],pointWrites:[] as {delta:number}[],calls:[] as {name:string;params:Record<string,unknown>}[],wrapper:true,payments:[] as {amount:number}[],paymentsError:false,paymentReads:0,wrapperError:null as {code:string;message:string}|null,attempted:[] as string[],wrapped:[] as {name:string;params:Record<string,unknown>}[]}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/clinic-payment",async()=>await import("../clinic-payment"));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
 from(table:string){
  let id="";
  const invoice={service_pricing_version:state.version,salesperson_id:state.savedSalesperson,id:"invoice",visit_id:"visit",invoice_no:"INV-FIC",request_key:state.retry?"request":"original-key",subtotal:90000,discount:0,tax:0,total:90000,dp_amount:0,paid_status:state.paidExisting?"Lunas":"Belum Lunas",metode_bayar:"QRIS",voucher_code:null,correction_pending:state.correctionPending};
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="id")id=value;return q;},is:()=>q,order:()=>q,limit:()=>q,update:(patch:{points?:number})=>{if(table==="visits")state.visitWrites.push(patch);if(table==="customers"&&patch.points!==undefined)state.balance=patch.points;return q;},insert:(row:{delta:number})=>{if(table==="point_ledger")state.pointWrites.push(row);return q;},
   maybeSingle:async()=>{if(table===state.failTable)throw Error(`read failed: ${table}`);if(table===state.errorTable)return {data:null,error:{message:`${table} unavailable`}};return {data:table==="medical_records"?{id:"record"}:table==="clinic_demo_policies"?{id:"policy",name:"DEMO",incentive_percent:5,fee_bearer:"customer",fee_rates:{Transfer:100},admin_revenue_code:"810004",admin_expense_code:"740010"}:table==="customers"?{points:state.balance,customer_categories:{is_active:true,rupiah_per_poin:10}}:table==="visits"?{branch_id:"branch",customer_id:state.customer?"customer":null,doctor_id:null,service_provider_id:"groomer"}:table==="employees"?(id==="groomer"?{id,branch_id:"branch"}:id==="foreign"?{id,branch_id:"other"}:null):table==="inpatient_records"&&state.inpatientOpen?{id:"active-inpatient"}:table==="invoices"?(state.existing||id==="invoice"?{...invoice,...(id==="old-invoice"?{id:"old-invoice"}:{})}:null):null,error:table==="invoices"&&((id==="invoice"&&state.postReadError)||(id!=="invoice"&&state.activeReadError))?{message:"Invoice read unavailable"}:null};},
   then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>(table===state.failTable?Promise.reject(Error(`read failed: ${table}`)):Promise.resolve(table===state.errorTable?{data:null,error:{message:`${table} unavailable`}}:table==="invoice_payments"?(state.paymentReads++,state.paymentsError?{data:null,error:{message:"payments unavailable"}}:{data:state.payments,error:null}):{data:[],error:null})).then(resolve,reject)};return q;
 },
 rpc:async(name:string,params:Record<string,unknown>)=>{
  if(name==="clinic_outpatient_cart_version"){keranjang.order.push(`versi:${params.p_visit_id}`);return keranjang.error?{data:null,error:keranjang.error}:{data:`v1:${String(params.p_visit_id).length.toString(16).padStart(32,"c")}`,error:null};}
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
vi.mock("@/lib/tagihan-klinik",async()=>{const real=await vi.importActual<typeof import("../tagihan-klinik")>("../tagihan-klinik");return {...real,hitungPotonganKlinik:async()=>({total:0,tolakVoucher:null})};});
vi.mock("@/lib/voucher",()=>({normalizeKode:()=>"",pesanVoucherDitolak:vi.fn(),potonganVoucher:vi.fn()}));
vi.mock("@/lib/klinik-posting",async()=>await import("../klinik-posting"));
vi.mock("@/lib/poin-klinik",async()=>await import("../poin-klinik"));
vi.mock("@/lib/customer-tier",()=>({recomputeCustomerTier:vi.fn(async()=>{state.tierAfterPoints=state.pointWrites.length;return true;})}));
vi.mock("@/lib/wa-engine",()=>({kirimStrukWa:vi.fn()}));
vi.mock("@/lib/manual-discount",async()=>{const real=await vi.importActual<typeof import("../manual-discount")>("../manual-discount");return {...real,manualDiscountAllowed:async()=>true};});
import { bayarVisit } from "../../app/(app)/klinik/pembayaran/[visitId]/actions";
// Kasus 17 Nov 2026: INV-202611-1285 (Grooming 90.000, QRIS, Lunas, hasil Void & Terbit Ulang -> correction_pending, uang 90.000 dipindahkan
// dari nota lama). Owner mengubah ke diskon 50% / harga 45.000 / diskon total 45.000. Database menolak (total baru < uang diterima) dengan
// kalimat generik. Aksi harus menolak LEBIH DULU dengan angka yang jelas, tanpa RPC, atau tetap menyerahkan ke database bila tidak yakin.
const line=(harga:number,diskon_persen=0)=>({deskripsi:"Grooming VET Lengkap + CU",qty:1,harga,jenis:"jasa",diskon_persen,item_id:"item"});
function koreksi(items:unknown[],discount=0){const d=new FormData();d.set("visitId","visit");d.set("requestKey","request-new");d.set("items",JSON.stringify(items));d.set("edit_reason","salah input harga");d.set("paid_status","Lunas");d.set("metode_bayar","QRIS");d.set("discount",String(discount));return d;}
async function pesan(f:FormData){try{await bayarVisit(f);return null;}catch(e){const m=String(e);return m.startsWith("Error: REDIRECT:")?decodeURIComponent(m.split("error=")[1]??""):m;}}
beforeEach(()=>{state.existing=true;state.correctionPending=true;state.paidExisting=true;state.retry=false;state.calls.length=0;state.payments=[{amount:90000}];state.paymentsError=false;state.paymentReads=0;});
describe("koreksi nota lunas ke total di bawah uang yang sudah diterima",()=>{
 it.each([["diskon baris 50%",[line(90000,50)],0],["harga 45.000",[line(45000)],0],["diskon total 45.000",[line(90000)],45000]] as const)("%s: ditolak di aplikasi dengan angka yang jelas, tanpa RPC",async(_n,items,disc)=>{
  const m=await pesan(koreksi([...items],disc));
  expect(m).toContain("Rp 45.000");expect(m).toContain("Rp 90.000");expect(m).toMatch(/lebih kecil dari uang yang sudah diterima/);expect(m).toMatch(/Belum ada yang tersimpan/);
  expect(state.calls).toEqual([]);
 });
 it("tanpa uang diterima tercatat, aplikasi tidak menolak sendiri (database penentu)",async()=>{
  state.payments=[];const f=koreksi([line(40000)]);const m=await pesan(f);
  expect(m).toBeNull();expect(state.calls[0].name).toBe("clinic_edit_invoice");
 });
 it("total tetap 90.000 diteruskan ke database",async()=>{
  expect(await pesan(koreksi([line(90000)]))).toBeNull();expect(state.calls[0]).toMatchObject({name:"clinic_edit_invoice",params:{p_invoice:{total:90000,subtotal:90000}}});
  expect(state.paymentReads).toBe(0);
 });
 it("total naik diteruskan ke database tanpa membaca pembayaran",async()=>{
  expect(await pesan(koreksi([line(100000)]))).toBeNull();expect(state.calls).toHaveLength(1);expect(state.paymentReads).toBe(0);
 });
 it("bila pembayaran tidak terbaca, aplikasi tidak menebak: database tetap penentu",async()=>{
  state.paymentsError=true;expect(await pesan(koreksi([line(45000)]))).toBeNull();expect(state.calls).toHaveLength(1);
 });
});
