import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc, from: state.from, auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) } }) }));
import { buatPenjualanOnline } from "@/app/(app)/penjualan/online/actions";
import { redeemReward, claimQuest } from "@/app/kasir/quest/actions";
import { batalkanPenjualan } from "@/app/(app)/penjualan/[id]/actions";
const id="00000000-0000-4000-8000-000000000001";
function form() { const f=new FormData(); f.set("id",id);f.set("revision","4");f.set("requestKey","durable-cancel");f.set("alasan","Barang salah");return f; }
beforeEach(() => { vi.clearAllMocks();state.rpc.mockResolvedValue({data:{voided:true},error:null});state.from.mockImplementation(()=>{throw new Error("Unexpected direct source access");}); });
it("cancels exclusively through atomic RPC with revision, reason and durable identity",async()=>{
 await expect(batalkanPenjualan(form())).rejects.toThrow("success=cancelled");
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_posted_sale",{p_sale_id:id,p_expected_revision:4,p_request_key:"durable-cancel",p_reason:"Barang salah"});
 expect(state.from).not.toHaveBeenCalled();expect(state.revalidate).toHaveBeenCalledWith("/","layout");
});
it("preserves RPC failure and never reports cancellation or starts replacement",async()=>{
 state.rpc.mockResolvedValue({data:null,error:{message:"Periode sumber sudah ditutup"}});
 await expect(batalkanPenjualan(form())).rejects.toThrow("Periode sumber sudah ditutup");
 expect(state.revalidate).not.toHaveBeenCalled();expect(state.from).not.toHaveBeenCalled();
});
it.each([null,"", "NaN", "-1"])("rejects invalid revision %s before mutation",async revision=>{
 const f=form(); if(revision===null) f.delete("revision");else f.set("revision",revision);
 await expect(batalkanPenjualan(f)).rejects.toThrow("Identitas");expect(state.rpc).not.toHaveBeenCalled();
});
it.each([[null,"/kasir"],["WA","/penjualan/online/baru"]])("replacement follows saved source channel %s only after cancellation",async(channel,path)=>{
 const q={select:()=>q,eq:()=>q,single:async()=>({data:{channel},error:null})};state.from.mockReturnValue(q);
 const f=form();f.set("tindakan","ganti");await expect(batalkanPenjualan(f)).rejects.toThrow(`${path}?replace_sale=${id}`);
 expect(state.rpc).toHaveBeenCalledTimes(1);
});
it("all explicit completion projections include void state",()=>{
 // Projections are part of the shared completion contract: missing void data
 // would otherwise silently include cancelled sales in reports.
 const files=["src/lib/dashboard.ts","src/lib/customer-tier.ts","src/lib/tutup-shift.ts","src/lib/komisi-data.ts","src/lib/loyalty-server.ts","src/lib/operation-sales-server.ts","src/lib/laporan-transaksi-server.ts","src/app/(app)/laporan/penjualan-barang/data.ts","src/app/(app)/laporan/penjualan-rinci/page.tsx","src/app/(app)/keuangan/sinkron/actions.ts"];
 for(const file of files){const selects=readFileSync(file,"utf8").split("\n").filter(line=>line.includes(".select(")&&line.includes("payments_finalized_at"));expect(selects.length,file).toBeGreaterThan(0);for(const select of selects)expect(select,file).toContain("voided_at");}
});

it("redeems rewards exclusively through durable atomic RPC", async () => {
 const f=new FormData();f.set("rewardId",id);f.set("requestKey","reward-retry");
 await expect(redeemReward(f)).rejects.toThrow("draft_done=reward-retry");
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith("redeem_staff_reward",{p_reward_id:id,p_request_key:"reward-retry"});
 expect(state.from).not.toHaveBeenCalled();
});
it("keeps failed redemption retry identity and never reports success", async () => {
 const f=new FormData();f.set("rewardId",id);f.set("requestKey","reward-retry");
 state.rpc.mockResolvedValue({error:{message:"Poin belum cukup"}});
 await expect(redeemReward(f)).rejects.toThrow("Poin belum cukup");expect(state.revalidate).not.toHaveBeenCalled();
});
it("requires a durable key before redeeming", async () => {
 const f=new FormData();f.set("rewardId",id);
 await expect(redeemReward(f)).rejects.toThrow("Identitas penukaran");expect(state.rpc).not.toHaveBeenCalled();
});
it("claims through the same serialized staff reward path", async () => {
 const f=new FormData();f.set("progressId",id);
 await expect(claimQuest(f)).rejects.toThrow("success=klaim");
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith("claim_staff_quest",{p_progress_id:id});expect(state.from).not.toHaveBeenCalled();
});

it.each(["missing-key", "bad-items", "rpc-error", "unconfirmed"])("keeps replacement draft and branch context after online %s", async failure => {
 const f=new FormData();f.set("request_scope",`online-replacement:${id}`);f.set("request_key","same-replacement-key");f.set("items","[]");
 if(failure==="missing-key") f.delete("request_key");
 if(failure==="bad-items") f.set("items","{");
 if(failure==="rpc-error") state.rpc.mockResolvedValue({data:null,error:{message:"Stock insufficient"}});
 if(failure==="unconfirmed") state.rpc.mockResolvedValue({data:null,error:null});
 await expect(buatPenjualanOnline(f)).rejects.toThrow(`replace_sale=${id}`);
 expect(state.revalidate).not.toHaveBeenCalled();
 if(failure==="rpc-error"||failure==="unconfirmed") expect(state.rpc).toHaveBeenCalledWith("post_online_order",expect.objectContaining({p_request_key:"same-replacement-key"}));
});
