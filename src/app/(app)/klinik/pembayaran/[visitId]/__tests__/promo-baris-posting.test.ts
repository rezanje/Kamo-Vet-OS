import { beforeEach, describe, expect, it, vi } from "vitest";
// Versi keranjang yang dibaca server untuk pembayaran rombongan (bukan dari layar).
const keranjang=vi.hoisted(()=>({order:[] as string[],error:null as {code?:string;message:string}|null}));
const state=vi.hoisted(()=>({version:null as 1|null,savedSalesperson:"groomer" as string|null,existing:false,retry:false,customer:false,balance:100,stockError:false,transportError:false,activeReadError:false,postReadError:false,checkoutError:false,lostResponse:false,paidExisting:false,inpatientOpen:false,correctionPending:false,shift:"open" as "open"|"none"|"throw",pajakThrow:false,periodeError:false,failTable:"",errorTable:"",tierAfterPoints:-1,visitWrites:[] as unknown[],pointWrites:[] as {delta:number}[],calls:[] as {name:string;params:Record<string,unknown>}[],wrapper:true,wrapperError:null as {code:string;message:string}|null,attempted:[] as string[],wrapped:[] as {name:string;params:Record<string,unknown>}[]}));
const potonganMesin=vi.hoisted(()=>({value:{total:0,tolakVoucher:null} as Record<string,unknown>}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
// Skenario lama di file ini dijalankan sebagai Owner/Admin (izin diskon manual menyala); blok "diskon manual tanpa izin" mematikannya.
const izin=vi.hoisted(()=>({boleh:true}));
vi.mock("@/lib/manual-discount", async (original) => ({ ...(await original<typeof import("@/lib/manual-discount")>()), manualDiscountAllowed: async () => izin.boleh }));
vi.mock("@/lib/clinic-payment",async()=>await vi.importActual("@/lib/clinic-payment"));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
 from(table:string){
  let id="";
  const invoice={service_pricing_version:state.version,salesperson_id:state.savedSalesperson,id:"invoice",visit_id:"visit",invoice_no:"INV-FIC",request_key:state.retry?"request":"original-key",subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:state.paidExisting?"Lunas":"Belum Lunas",metode_bayar:"Tunai",voucher_code:null,correction_pending:state.correctionPending};
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="id")id=value;return q;},is:()=>q,order:()=>q,limit:()=>q,update:(patch:{points?:number})=>{if(table==="visits")state.visitWrites.push(patch);if(table==="customers"&&patch.points!==undefined)state.balance=patch.points;return q;},insert:(row:{delta:number})=>{if(table==="point_ledger")state.pointWrites.push(row);return q;},
   maybeSingle:async()=>{if(table===state.failTable)throw Error(`read failed: ${table}`);if(table===state.errorTable)return {data:null,error:{message:`${table} unavailable`}};return {data:table==="medical_records"?{id:"record"}:table==="clinic_demo_policies"?{id:"policy",name:"DEMO",incentive_percent:5,fee_bearer:"customer",fee_rates:{Transfer:100},admin_revenue_code:"810004",admin_expense_code:"740010"}:table==="customers"?{points:state.balance,customer_categories:{is_active:true,rupiah_per_poin:10}}:table==="visits"?{branch_id:"branch",customer_id:state.customer?"customer":null,doctor_id:null,service_provider_id:"groomer"}:table==="employees"?(id==="groomer"?{id,branch_id:"branch"}:id==="foreign"?{id,branch_id:"other"}:null):table==="inpatient_records"&&state.inpatientOpen?{id:"active-inpatient"}:table==="invoices"?(state.existing||id==="invoice"?{...invoice,...(id==="old-invoice"?{id:"old-invoice"}:{})}:null):null,error:table==="invoices"&&((id==="invoice"&&state.postReadError)||(id!=="invoice"&&state.activeReadError))?{message:"Invoice read unavailable"}:null};},
   then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>(table===state.failTable?Promise.reject(Error(`read failed: ${table}`)):Promise.resolve(table===state.errorTable?{data:null,error:{message:`${table} unavailable`}}:{data:[],error:null})).then(resolve,reject)};return q;
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
vi.mock("@/lib/tanggal",async()=>await vi.importActual("@/lib/tanggal"));
vi.mock("@/lib/pajak",()=>({getPajakSettings:async()=>{if(state.pajakThrow)throw Error("Pajak read failed");return {};},tambahPpn:(dpp:number)=>({tax:0,total:dpp})}));
vi.mock("@/lib/rombongan-server",()=>({bacaRombongan:vi.fn()}));
vi.mock("@/lib/tagihan-klinik",()=>({nilaiBaris:(r:{qty:number;harga:number;diskon_persen?:number})=>r.qty*r.harga*(1-(r.diskon_persen??0)/100),hargaNetto:(r:{harga:number;diskon_persen?:number})=>r.harga*(1-(r.diskon_persen??0)/100),hitungPotonganKlinik:async()=>potonganMesin.value,barisTagihanVisit:vi.fn(),bagiPotongan:vi.fn()}));
vi.mock("@/lib/voucher",()=>({normalizeKode:()=>"",pesanVoucherDitolak:vi.fn(),potonganVoucher:vi.fn()}));
vi.mock("@/lib/klinik-posting",async()=>await vi.importActual("@/lib/klinik-posting"));
vi.mock("@/lib/poin-klinik",async()=>await vi.importActual("@/lib/poin-klinik"));
vi.mock("@/lib/customer-tier",()=>({recomputeCustomerTier:vi.fn(async()=>{state.tierAfterPoints=state.pointWrites.length;return true;})}));
vi.mock("@/lib/wa-engine",()=>({kirimStrukWa:vi.fn()}));
import { bayarVisit } from "../actions";
function form(items:unknown[],extra:Record<string,string>={}){const f=new FormData();f.set("visitId","visit");f.set("requestKey","request-promo");f.set("items",JSON.stringify(items));f.set("metode_bayar","Tunai");for(const [k,v] of Object.entries(extra))f.set(k,v);return f;}
const ANTHEL={deskripsi:"Anthel Cat",qty:1,harga:18000,jenis:"obat",item_id:"item-anthel",satuan:"pcs"};
const GROOM={deskripsi:"Grooming VET Lengkap",qty:1,harga:90000,jenis:"jasa",item_id:"item-grooming",satuan:"jasa"};
const PROMO_GROOM11={promo:45000,voucher:0,golongan:0,total:45000,tolakVoucher:null,voucherCode:null,campaignCode:"GROOM11",
 rincianPromo:[{item_id:"item-grooming",promo_id:"promo-groom11",promo_name:"Grooming 11.11",potongan:45000}]};
beforeEach(()=>{
 state.version=null;state.savedSalesperson="groomer";state.stockError=false;state.transportError=false;state.activeReadError=false;state.postReadError=false;state.checkoutError=false;state.lostResponse=false;state.paidExisting=false;state.inpatientOpen=false;state.correctionPending=false;state.shift="open";state.pajakThrow=false;state.periodeError=false;state.failTable="";state.errorTable="";state.tierAfterPoints=-1;state.visitWrites=[];state.existing=false;state.retry=false;state.customer=false;state.balance=100;state.pointWrites=[];state.calls=[];state.wrapper=true;state.wrapperError=null;state.attempted=[];state.wrapped=[];
 potonganMesin.value={total:0,tolakVoucher:null};
 izin.boleh=true;
});
const posting=()=>state.calls.find(c=>["clinic_post_invoice","clinic_post_split_invoice","clinic_post_demo_invoice","clinic_post_dp_and_admit"].includes(c.name));
type L={description:string;promo_discount?:number};
describe("lantai harga: potongan promo dikirim per baris (GROOM11)",()=>{
 it("Grooming Rp90.000 kena promo 45.000, Anthel Rp18.000 tidak: promo_discount hanya di baris Grooming; diskon invoice tetap 45.000",async()=>{
  potonganMesin.value=PROMO_GROOM11;
  await bayarVisit(form([ANTHEL,GROOM],{voucherCode:"GROOM11"}));
  const p=posting()!;const lines=p.params.p_lines as L[];
  expect(p.params.p_invoice).toMatchObject({subtotal:108000,discount:45000,total:63000});
  expect(lines.find(l=>l.description==="Grooming VET Lengkap")?.promo_discount).toBe(45000);
  expect("promo_discount" in lines.find(l=>l.description==="Anthel Cat")!).toBe(false);
 });
 it("diskon manual kasir ditambahkan ke diskon invoice, promo per baris tetap 45.000 (sisanya dibagi database)",async()=>{
  potonganMesin.value=PROMO_GROOM11;
  await bayarVisit(form([ANTHEL,GROOM],{voucherCode:"GROOM11",discount:"10800"}));
  const p=posting()!;const lines=p.params.p_lines as L[];
  expect(p.params.p_invoice).toMatchObject({discount:55800});
  expect(lines.find(l=>l.description==="Grooming VET Lengkap")?.promo_discount).toBe(45000);
 });
 it("tanpa promo: kunci promo_discount tidak ada di baris mana pun (muatan lama persis; hash idempotensi tak berubah)",async()=>{
  await bayarVisit(form([ANTHEL,GROOM]));
  const lines=posting()!.params.p_lines as L[];
  expect(lines.every(l=>!("promo_discount" in l))).toBe(true);
 });
 it("diskon manual saja (tanpa rincian promo): tidak ada promo_discount",async()=>{
  potonganMesin.value={total:0,tolakVoucher:null};
  await bayarVisit(form([ANTHEL,GROOM],{discount:"20000"}));
  expect((posting()!.params.p_lines as L[]).every(l=>!("promo_discount" in l))).toBe(true);
 });
 it("diskon baris persen: promo dihitung dari nilai setelah diskon baris dan tidak melebihinya",async()=>{
  potonganMesin.value={...PROMO_GROOM11,promo:99999,total:99999,rincianPromo:[{item_id:"item-grooming",promo_id:"p",promo_name:"P",potongan:99999}]};
  await bayarVisit(form([ANTHEL,{...GROOM,diskon_persen:10}]));
  const lines=posting()!.params.p_lines as L[];
  expect(lines.find(l=>l.description==="Grooming VET Lengkap")?.promo_discount).toBe(81000);
 });
 it("koreksi tagihan: tidak mengirim promo_discount (database mewarisi dari baris asal)",async()=>{
  state.existing=true;potonganMesin.value=PROMO_GROOM11;
  const f=form([{...ANTHEL,source_invoice_item_id:"old-1"},{...GROOM,source_invoice_item_id:"old-2"}],{edit_reason:"Koreksi"});
  await bayarVisit(f);
  const edit=state.calls.find(c=>c.name==="clinic_edit_invoice")!;
  expect((edit.params.p_lines as L[]).every(l=>!("promo_discount" in l))).toBe(true);
 });
});
describe("diskon manual tanpa izin (anak toko/staf, 12 Nov 2026)",()=>{
 const DITOLAK="Diskon%20manual%20hanya%20bisa%20diberikan%20Owner%2FAdmin";
 const coba=(f:FormData)=>bayarVisit(f).then(()=>"lolos",(e:Error)=>e.message);
 beforeEach(()=>{izin.boleh=false;});
 it("diskon total pada tagihan baru ditolak; tidak ada posting",async()=>{
  expect(await coba(form([ANTHEL,GROOM],{discount:"10000"}))).toContain(DITOLAK);
  expect(posting()).toBeUndefined();
 });
 it("diskon % per baris pada tagihan baru ditolak; tidak ada posting",async()=>{
  expect(await coba(form([ANTHEL,{...GROOM,diskon_persen:10}]))).toContain(DITOLAK);
  expect(posting()).toBeUndefined();
 });
 it("promo otomatis tetap jalan tanpa izin diskon manual",async()=>{
  potonganMesin.value=PROMO_GROOM11;
  await bayarVisit(form([ANTHEL,GROOM],{voucherCode:"GROOM11"}));
  expect(posting()!.params.p_invoice).toMatchObject({discount:45000});
 });
 it("koreksi: menambah diskon baris di atas yang tersimpan ditolak",async()=>{
  state.existing=true;
  const f=form([{...ANTHEL,source_invoice_item_id:"old-1",diskon_persen:20},{...GROOM,source_invoice_item_id:"old-2"}],{edit_reason:"Koreksi"});
  expect(await coba(f)).toContain(DITOLAK);
 });
});
