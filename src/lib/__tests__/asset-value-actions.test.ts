import { beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/master-guard",()=>({assertRole:async()=>f}));
vi.mock("@/lib/kas-akun",()=>({kodeAkunBayar:async()=>"110299"}));
vi.mock("@/lib/jurnal-guard",()=>({cekPeriode:async()=>null}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(url);}}));
import { tambahNilaiAset } from "@/app/(app)/keuangan/aset/[id]/actions";
const form=()=>{const x=new FormData();Object.entries({id:"asset",tambahan:"1000",tanggal:"2026-10-21",draft_key:"addition-key",draft_scope:"asset-value:asset"}).forEach(([k,v])=>x.set(k,v));return x;};
beforeEach(()=>{
 f.rpc.mockReset();f.from.mockReset();
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:"asset",status:"aktif",branch_id:"branch",harga_perolehan:10000000}})};
 f.from.mockReturnValue(q);
});
it("acknowledges capitalization only after its atomic asset/history/journal receipt",async()=>{
 f.rpc.mockResolvedValue({data:{change_id:"change",journal_id:"journal"},error:null});
 await expect(tambahNilaiAset(form())).rejects.toThrow("draft_done=addition-key");
 expect(f.rpc).toHaveBeenCalledWith("add_fixed_asset_value_atomic",expect.objectContaining({p_request_key:"addition-key",p_asset_id:"asset",p_amount:1000}));
});
it("retains the form if capitalization fails or its journal is unconfirmed",async()=>{
 f.rpc.mockResolvedValue({data:{change_id:"change"},error:null});
 await expect(tambahNilaiAset(form())).rejects.toThrow("?error=");
});
