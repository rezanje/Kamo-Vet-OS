import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({role:"OWNER",active:false,seen:[] as string[]}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error("REDIRECT:"+url)}}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"actor"}}})},from(table:string){state.seen.push(table);const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:state.role,is_active:state.active}})};return q;}})}));
import { simpanBarang } from "../../app/(app)/pos/sku/actions";
import { simpanMerek } from "../../app/(app)/pos/merek/actions";
import { siapkanFormBarang } from "../../app/(app)/pos/sku/data";
import { saveVariantFamily } from "../../app/(app)/pos/sku/varian/actions";
import { tambahSupplier } from "../../app/(app)/pembelian/actions";
beforeEach(()=>{state.seen=[];state.role="OWNER";state.active=false;});
it.each([
 ["SKU",simpanBarang],["merek",simpanMerek],["form SKU",siapkanFormBarang],["varian",saveVariantFamily],["pemasok",tambahSupplier],
] as const)("rejects an inactive OWNER before accessing %s",async(_label,action)=>{
 await expect(action(new FormData())).rejects.toThrow("REDIRECT:");expect(state.seen).toEqual(["profiles"]);
});
it.each(["STAFF","DOCTOR","FINANCE"])("does not broaden master mutation access to %s",async role=>{
 state.role=role;state.active=true;await expect(simpanMerek(new FormData())).rejects.toThrow("REDIRECT:");expect(state.seen).toEqual(["profiles"]);
});
it("preserves query parameters in an authorization rejection",async()=>{
 await expect(tambahSupplier(new FormData())).rejects.toThrow("/pembelian?tab=supplier&error=");
});
