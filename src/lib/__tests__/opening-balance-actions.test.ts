import {beforeEach,expect,it,vi} from "vitest";
const {rpc,guard,redirect}=vi.hoisted(()=>({rpc:vi.fn(),guard:vi.fn(),redirect:vi.fn((url:string):never=>{throw new Error(url);})}));
vi.mock("@/lib/master-guard",()=>({assertRole:guard}));
vi.mock("next/navigation",()=>({redirect}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {simpanSaldoAwal,hapusSaldoAwal,pulihkanSaldoAwal} from "@/app/(app)/keuangan/saldo-awal/actions";
beforeEach(()=>{vi.clearAllMocks();guard.mockResolvedValue({rpc});rpc.mockResolvedValue({data:{entry_id:"opening-entry"},error:null});});
function form(){const data=new FormData();for(const [key,value] of Object.entries({tanggal:"2026-10-20",baris:JSON.stringify([{code:"1101",nilai:500,sisi:"D"}]),draft_key:"opening-key",draft_scope:"opening-balance-create",expected_entry_id:"previous-entry",reason:"Koreksi simulasi"}))data.set(key,value);return data;}
it("posts full replacement with expected source and stable request in one RPC",async()=>{
 await expect(simpanSaldoAwal(form())).rejects.toThrow("success=");
 expect(rpc).toHaveBeenCalledWith("mutate_opening_balance",{p_request_key:"opening-key",p_expected_entry_id:"previous-entry",p_action:"save",p_tanggal:"2026-10-20",p_rows:[{code:"1101",nilai:500,sisi:"D"}],p_reason:"Koreksi simulasi"});
 expect(redirect.mock.calls[0][0]).toContain("draft_done=opening-key");
});
it("voids through audited reversal rather than deleting the old journal",async()=>{
 await expect(hapusSaldoAwal(form())).rejects.toThrow("success=");
 expect(rpc.mock.calls[0][1]).toMatchObject({p_action:"void",p_expected_entry_id:"previous-entry",p_tanggal:null,p_rows:[]});
});
it.each([{data:null,error:{message:"Periode akuntansi sudah ditutup"}},{data:null,error:null}])("keeps draft after rejected or unconfirmed opening",async response=>{
 rpc.mockResolvedValue(response);await expect(simpanSaldoAwal(form())).rejects.toThrow("error=");
 expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});
it("rejects missing durable key before any posting",async()=>{const data=form();data.delete("draft_key");await expect(simpanSaldoAwal(data)).rejects.toThrow("error=");expect(rpc).not.toHaveBeenCalled();});
it("confirms a saved request without permitting a new correction",async()=>{
 await expect(pulihkanSaldoAwal(form())).rejects.toThrow("success=");
 expect(rpc).toHaveBeenCalledWith("get_opening_balance_result",{p_request_key:"opening-key"});
 expect(redirect.mock.calls[0][0]).toContain("draft_done=opening-key");
});
it("does not discard a pending request that has no confirmed result",async()=>{
 rpc.mockResolvedValue({data:null,error:null});await expect(pulihkanSaldoAwal(form())).rejects.toThrow("error=");
 expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});
