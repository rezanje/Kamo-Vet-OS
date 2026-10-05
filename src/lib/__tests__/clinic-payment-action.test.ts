import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({existing:false,retry:false,customer:false,balance:100,pointWrites:[] as {delta:number}[],calls:[] as {name:string;params:Record<string,unknown>}[]}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/clinic-payment",async()=>await import("../clinic-payment"));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
 from(table:string){
  let id="";
  const invoice={id:"invoice",invoice_no:"INV-FIC",request_key:state.retry?"request":"original-key",subtotal:100,discount:0,tax:0,total:100,dp_amount:0,paid_status:"Belum Lunas",metode_bayar:"Tunai",voucher_code:null,correction_pending:false};
  const q={select:()=>q,eq:(key:string,value:string)=>{if(key==="id")id=value;return q;},is:()=>q,order:()=>q,limit:()=>q,update:(patch:{points?:number})=>{if(table==="customers"&&patch.points!==undefined)state.balance=patch.points;return q;},insert:(row:{delta:number})=>{if(table==="point_ledger")state.pointWrites.push(row);return q;},
   maybeSingle:async()=>({data:table==="customers"?{points:state.balance,customer_categories:{is_active:true,rupiah_per_poin:10}}:table==="visits"?{branch_id:"branch",customer_id:state.customer?"customer":null,doctor_id:null,service_provider_id:"groomer"}:table==="employees"?(id==="groomer"?{id,branch_id:"branch"}:id==="foreign"?{id,branch_id:"other"}:null):table==="invoices"?(state.existing||id==="invoice"?invoice:null):null,error:null}),
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};return q;
 },
 rpc:async(name:string,params:Record<string,unknown>)=>{state.calls.push({name,params});return {data:name==="clinic_post_invoice"?"invoice":null,error:null};},
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
beforeEach(()=>{state.existing=false;state.retry=false;state.customer=false;state.balance=100;state.pointWrites=[];state.calls=[];});
describe("clinic payment salesperson boundary",()=>{
 it("posts an eligible groomer and the selected medicine unit",async()=>{
  await expect(bayarVisit(form("groomer"))).resolves.toEqual({saved:true,href:"/klinik/pembayaran/visit?success=bayar"});
  expect(state.calls[0]).toMatchObject({name:"clinic_post_invoice",params:{p_invoice:{salesperson_id:"groomer"},p_lines:[{unit:"box"}]}});
 });
 it("rejects a cross-branch salesperson before invoice posting",async()=>{
  await expect(bayarVisit(form("foreign"))).rejects.toThrow("?error=");expect(state.calls).toEqual([]);
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

});
