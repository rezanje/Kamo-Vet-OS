import {beforeEach,expect,it,vi} from "vitest";
const fixture=vi.hoisted(()=>({rpc:vi.fn(),approval:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:fixture.rpc,from:fixture.from,auth:{getUser:async()=>({data:{user:{id:"user"}}})}})}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Object.assign(Error(url),{digest:"NEXT_REDIRECT"});}}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/persetujuan-server",()=>({cekPersetujuan:fixture.approval}));
vi.mock("@/lib/jurnal-guard",()=>({cekPeriode:async()=>null}));
import {bayarFaktur} from "@/app/(app)/pembelian/faktur/actions";
const data=()=>{const fd=new FormData();Object.entries({invoice_id:"invoice",draft_key:"key",draft_scope:"payable-settle:invoice",amount:"10",tanggal:"2026-10-07"}).forEach(([k,v])=>fd.set(k,v));return fd;};
beforeEach(()=>{vi.clearAllMocks();fixture.approval.mockResolvedValue({boleh:true});const q={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{id:"invoice",no_faktur:"FB-1"},error:null})};fixture.from.mockReturnValue(q);});
it("recovers exact submitted payment before consumed approval or period work and acknowledges its key",async()=>{fixture.rpc.mockResolvedValueOnce({data:{payment_id:"p",journal_id:"j",no_faktur:"FB-1"},error:null});await expect(bayarFaktur(data())).rejects.toThrow("draft_done=key&draft_scope=payable-settle%3Ainvoice");expect(fixture.approval).not.toHaveBeenCalled();expect(fixture.rpc).toHaveBeenCalledTimes(1);});
it("calls the atomic payment RPC and defers approval consumption until the posting transaction",async()=>{fixture.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{payment_id:"p",journal_id:"j",no_faktur:"FB-1"},error:null});await expect(bayarFaktur(data())).rejects.toThrow("draft_done=key");expect(fixture.approval.mock.calls[0][1]).toMatchObject({deferConsumption:true});expect(fixture.rpc.mock.calls[1]).toEqual(["pay_purchase_invoice_atomic",expect.objectContaining({p_request_key:"key",p_invoice_id:"invoice",p_amount:10})]);});
it("never acknowledges a rejected posting or missing journal confirmation",async()=>{fixture.rpc.mockResolvedValueOnce({data:null,error:null}).mockResolvedValueOnce({data:{payment_id:"p",no_faktur:"FB-1"},error:null});await expect(bayarFaktur(data())).rejects.toThrow("belum terkonfirmasi lengkap");});

it("rejects fractional payment before approval or posting to match existing whole-rupiah journals",async()=>{const fd=data();fd.set("amount","1.4");await expect(bayarFaktur(fd)).rejects.toThrow("rupiah%20bulat");expect(fixture.rpc).not.toHaveBeenCalled();expect(fixture.approval).not.toHaveBeenCalled();});

vi.mock("@/lib/master-guard",()=>({assertRole:async()=>({rpc:fixture.rpc})}));
import {bayarPerintahBayar} from "@/app/(app)/pembelian/perintah-bayar/actions";
it("settles the approved payment order through one atomic RPC and acknowledges only its complete journal",async()=>{const fd=data();fd.set("id","order");fixture.rpc.mockResolvedValueOnce({data:{order_id:"order",no_pp:"PP-1",journal_id:"journal"},error:null});await expect(bayarPerintahBayar(fd)).rejects.toThrow("draft_done=key");expect(fixture.rpc).toHaveBeenCalledOnce();expect(fixture.rpc).toHaveBeenCalledWith("pay_purchase_payment_order_atomic",{p_request_key:"key",p_order_id:"order",p_tanggal:"2026-10-07",p_metode:"Transfer",p_account_id:null});});
it("does not acknowledge a payment-order journal missing from the server response",async()=>{const fd=data();fd.set("id","order");fixture.rpc.mockResolvedValueOnce({data:{order_id:"order",no_pp:"PP-1"},error:null});await expect(bayarPerintahBayar(fd)).rejects.toThrow("belum terkonfirmasi lengkap");});
