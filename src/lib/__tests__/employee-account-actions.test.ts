import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({
 admin:true,employee:{id:"employee",profile_id:null as string|null,status:"Aktif"},
 rpc:vi.fn(),signup:vi.fn(),selected:vi.fn(),
}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:()=>({auth:{signUp:state.signup}})}));
vi.mock("@/lib/master-guard",()=>({assertMasterAdmin:async()=>{
 if(!state.admin) throw new Error("ADMIN_REQUIRED");
 return {rpc:state.rpc,from:(table:string)=>{
  state.selected(table);
  const chain={select:()=>chain,eq:()=>chain,in:()=>chain,maybeSingle:async()=>({data:state.employee}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{id:"branch"}]}).then(resolve)};
  return chain;
 }};
}}));
import { buatPengguna, tautkanPengguna } from "@/app/(app)/pengaturan/pengguna/actions";
function form(){const f=new FormData();for(const [key,value] of Object.entries({full_name:"Fictional Employee",email:"employee@test.local",password:"fictional-password",role:"STAFF",employee_id:"employee"}))f.set(key,value);f.append("branch_ids","branch");return f;}
beforeEach(()=>{state.admin=true;state.employee.profile_id=null;state.employee.status="Aktif";state.rpc.mockReset().mockResolvedValue({error:null});state.signup.mockReset().mockResolvedValue({data:{user:{id:"new-user"}},error:null});state.selected.mockClear();});
describe("employee account creation",()=>{
 it("requires HRIS identity before invoking Auth signup",async()=>{const f=form();f.delete("employee_id");await expect(buatPengguna(f)).rejects.toThrow("REDIRECT:");expect(state.signup).not.toHaveBeenCalled();});
 it("rejects nonadmins before any account operation",async()=>{state.admin=false;await expect(buatPengguna(form())).rejects.toThrow("ADMIN_REQUIRED");expect(state.signup).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();});
 it("rejects already linked or inactive employees",async()=>{state.employee.profile_id="existing";await expect(buatPengguna(form())).rejects.toThrow("REDIRECT:");state.employee.profile_id=null;state.employee.status="Nonaktif";await expect(buatPengguna(form())).rejects.toThrow("REDIRECT:");expect(state.signup).not.toHaveBeenCalled();});
 it("does not treat empty staff branch grants as all branches",async()=>{const f=form();f.delete("branch_ids");await expect(buatPengguna(f)).rejects.toThrow("REDIRECT:");expect(state.signup).not.toHaveBeenCalled();});
 it("configures the same canonical employee and new profile in one RPC",async()=>{await expect(buatPengguna(form())).rejects.toThrow("success=");expect(state.rpc).toHaveBeenCalledWith("configure_employee_account",{p_profile_id:"new-user",p_employee_id:"employee",p_role:"STAFF",p_full_name:"Fictional Employee",p_branch_ids:["branch"]});});
 it("reports partial Auth/configuration failure without success or duplicate signup",async()=>{state.rpc.mockResolvedValue({error:{message:"conflict"}});await expect(buatPengguna(form())).rejects.toThrow("error=");expect(state.signup).toHaveBeenCalledOnce();});
 it("repairs an existing link without role or branch mutations",async()=>{const f=new FormData();f.set("profile_id","existing");f.set("employee_id","employee");await expect(tautkanPengguna(f)).rejects.toThrow("success=");expect(state.rpc).toHaveBeenCalledWith("link_employee_account",{p_profile_id:"existing",p_employee_id:"employee"});expect(state.signup).not.toHaveBeenCalled();expect(state.selected).not.toHaveBeenCalled();});
});
