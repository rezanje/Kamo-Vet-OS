import {beforeEach,expect,it,vi} from "vitest";
const {rpc,client,redirect}=vi.hoisted(()=>({rpc:vi.fn(),client:vi.fn(),redirect:vi.fn((url:string):never=>{throw new Error(url);})}));
vi.mock("@/lib/supabase/server",()=>({createClient:client}));
vi.mock("next/navigation",()=>({redirect}));
import {jurnalManual} from "@/app/(app)/keuangan/jurnal/actions";

beforeEach(()=>{vi.clearAllMocks();client.mockResolvedValue({rpc});});
function input(){const data=new FormData();for(const [key,value] of Object.entries({tanggal:"2026-10-20",deskripsi:"Manual test",branchId:"branch",draft_key:"durable-key",draft_scope:"journal-create",lines:JSON.stringify([{account_id:"cash",debit:100.25,credit:0},{account_id:"income",debit:0,credit:100.25}])}))data.set(key,value);return data;}
it("posts one atomic request and clears only the confirmed draft",async()=>{
 rpc.mockResolvedValue({data:{entry_id:"journal-id"},error:null});
 await expect(jurnalManual(input())).rejects.toThrow("success=1");
 expect(rpc).toHaveBeenCalledTimes(1);expect(rpc).toHaveBeenCalledWith("create_manual_journal_atomic",{p_request_key:"durable-key",p_tanggal:"2026-10-20",p_deskripsi:"Manual test",p_branch_id:"branch",p_lines:[{account_id:"cash",debit:100.25,credit:0},{account_id:"income",debit:0,credit:100.25}]});
 expect(redirect.mock.calls[0][0]).toContain("draft_done=durable-key");
});
it.each([{data:null,error:{message:"Posting rejected"}},{data:null,error:null}])("does not acknowledge an unconfirmed posting",async result=>{
 rpc.mockResolvedValue(result);const data=input();
 await expect(jurnalManual(data)).rejects.toThrow("error=");
 expect(redirect.mock.calls[0][0]).not.toContain("draft_done");expect(data.get("draft_key")).toBe("durable-key");
});
it("rejects an unavailable identity or malformed line collection before posting",async()=>{
 const noKey=input();noKey.delete("draft_key");await expect(jurnalManual(noKey)).rejects.toThrow("error=");
 const badLines=input();badLines.set("lines","{}");await expect(jurnalManual(badLines)).rejects.toThrow("error=");
 expect(client).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
});
