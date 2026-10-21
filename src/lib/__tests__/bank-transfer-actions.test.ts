import {beforeEach,expect,it,vi} from "vitest";
const {rpc,guard,redirect}=vi.hoisted(()=>({rpc:vi.fn(),guard:vi.fn(),redirect:vi.fn((url:string):never=>{throw new Error(url);})}));
vi.mock("@/lib/master-guard",()=>({assertRole:guard}));
vi.mock("next/navigation",()=>({redirect}));
import {buatTransfer,batalkanTransfer,koreksiTransfer} from "@/app/(app)/kas-bank/transfer/actions";
beforeEach(()=>{vi.clearAllMocks();guard.mockResolvedValue({rpc});rpc.mockResolvedValue({data:{transfer_id:"transfer",revision:0},error:null});});
function form(){const data=new FormData();for(const [key,value] of Object.entries({tanggal:"2026-10-20",from_account_id:"cash",to_account_id:"bank",jumlah:"100.25",biaya_admin:"1.25",branch_id:"branch",keterangan:"Transfer test",draft_key:"transfer-key",draft_scope:"bank-transfer-create",id:"transfer",revision:"0",reason:"Koreksi simulasi"}))data.set(key,value);return data;}
it("creates transfer and journal through one durable atomic request",async()=>{
 await expect(buatTransfer(form())).rejects.toThrow("success=1");
 expect(rpc).toHaveBeenCalledWith("mutate_cash_transfer",{p_request_key:"transfer-key",p_action:"create",p_transfer_id:null,p_expected_revision:null,p_header:{tanggal:"2026-10-20",from_account_id:"cash",to_account_id:"bank",jumlah:100.25,biaya_admin:1.25,branch_id:"branch",keterangan:"Transfer test"},p_reason:null});
 expect(redirect.mock.calls[0][0]).toContain("draft_done=transfer-key");
});
it.each([[koreksiTransfer,"edit"],[batalkanTransfer,"void"]] as const)("uses revision and reason for audited corrections",async(action,mode)=>{
 await expect(action(form())).rejects.toThrow("success=");
 expect(rpc.mock.calls[0][1]).toMatchObject({p_action:mode,p_transfer_id:"transfer",p_expected_revision:0,p_reason:"Koreksi simulasi",p_request_key:"transfer-key"});
});
it.each([{data:null,error:{message:"Periode akuntansi sudah ditutup"}},{data:null,error:null}])("keeps draft after rejected or unconfirmed transfer",async response=>{
 rpc.mockResolvedValue(response);await expect(buatTransfer(form())).rejects.toThrow("error=");
 expect(redirect.mock.calls[0][0]).not.toContain("draft_done");
});
it("rejects an unavailable durable identity before writing",async()=>{const data=form();data.delete("draft_key");await expect(buatTransfer(data)).rejects.toThrow("error=");expect(rpc).not.toHaveBeenCalled();});
