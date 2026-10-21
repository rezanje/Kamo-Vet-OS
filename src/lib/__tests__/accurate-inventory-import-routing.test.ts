import { expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({rpc:vi.fn(),auth:{getUser:vi.fn(async()=>({data:{user:{id:"owner"}}}))},from:vi.fn(()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:"OWNER"}})})})}))}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>db}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {postSaldoAwalAccurate} from "@/app/(app)/pos/sku/impor/actions";
it("routes stock-only import submission to the explicit accounting review without a posting RPC",async()=>{
 const data=new FormData();data.set("confirm_scope","on");
 const result=await postSaldoAwalAccurate(data);
 expect(result.ok).toBe(false);
 expect(result.message).toContain("Persediaan Awal");
 expect(db.rpc).not.toHaveBeenCalled();
});
