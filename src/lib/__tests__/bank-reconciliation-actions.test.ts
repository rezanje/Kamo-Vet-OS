import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({rpc:vi.fn(),guard:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Error(url);}}));
vi.mock("@/lib/master-guard",()=>({assertRole:state.guard}));
import { prosesRekonsiliasi, koreksiRekonsiliasi, batalkanRekonsiliasi, pulihkanRekonsiliasi } from "@/app/(app)/keuangan/rekonsiliasi/actions";
const id="efa40000-0000-4000-8000-000000000001";
const form=()=>{const f=new FormData();Object.entries({draft_key:"same-key",draft_scope:"bank-reconciliation-create",id,revision:"2",reason:"Correct statement",account_id:id,tanggal:"2026-01-01",saldo_bank:"100.25",biaya_adm:"2.10",bunga:"1.05",catatan:"Note"}).forEach(([k,v])=>f.set(k,v));return f;};
beforeEach(()=>{vi.clearAllMocks();state.guard.mockResolvedValue({rpc:state.rpc});state.rpc.mockResolvedValue({data:{reconciliation_id:id,revision:3},error:null});});
it.each([[prosesRekonsiliasi,"create"],[koreksiRekonsiliasi,"edit"],[batalkanRekonsiliasi,"void"]] as const)("submits %s only once through the atomic family operation",async(action,mode)=>{
 const f=form();await expect(action(f)).rejects.toThrow(`/keuangan/rekonsiliasi/${id}?success=${mode}`);
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith("mutate_bank_reconciliation",expect.objectContaining({p_request_key:"same-key",p_action:mode,p_id:mode==="create"?null:id,p_expected_revision:mode==="create"?null:2}));
 expect(state.guard).toHaveBeenCalledWith("/keuangan/rekonsiliasi","rekonsiliasi bank",mode==="create"?["OWNER","ADMIN","FINANCE"]:["OWNER"]);
});
it("keeps the correction destination and input acknowledgement on a posting failure",async()=>{
 state.rpc.mockResolvedValue({data:null,error:{message:"Periode ditutup"}});
 await expect(koreksiRekonsiliasi(form())).rejects.toThrow(`/keuangan/rekonsiliasi/${id}?error=Periode%20ditutup`);
 expect(state.rpc).toHaveBeenCalledTimes(1);
});
it("rejects missing identity before any money operation",async()=>{
 const f=form();f.delete("draft_key");await expect(prosesRekonsiliasi(f)).rejects.toThrow("Identitas");expect(state.rpc).not.toHaveBeenCalled();
});
it("checks an uncertain result without replaying the original posting",async()=>{
 await expect(pulihkanRekonsiliasi(form())).rejects.toThrow("success=recovered");
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith("get_bank_reconciliation_result",{p_request_key:"same-key"});
});
it("does not acknowledge an absent prior result",async()=>{
 state.rpc.mockResolvedValue({data:null,error:null});
 await expect(pulihkanRekonsiliasi(form())).rejects.toThrow("Hasil%20belum%20tercatat");expect(state.rpc).toHaveBeenCalledTimes(1);
});

it("explains a competing bookkeeping process without exposing lock errors",async()=>{
 state.rpc.mockResolvedValue({data:null,error:{code:"40P01",message:"deadlock detected"}});
 await expect(prosesRekonsiliasi(form())).rejects.toThrow("Pembukuan%20sedang%20dipakai");expect(state.rpc).toHaveBeenCalledTimes(1);
});
