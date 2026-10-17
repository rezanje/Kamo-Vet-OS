import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: { id: "user" } as {id:string}|null,
  profile: { role: "STAFF", is_active: true }, capabilities: { all_branches: false, create_accounts: false }, rules: [] as {role:string;module_id:string}[], rulesError: null as unknown,
  grants: ["eb200000-0000-4000-8000-000000000001"],
  branch: {id:"eb200000-0000-4000-8000-000000000001",name:"Fictional A",code:"A",type:"BOTH",is_active:true},
  shift: null as {branch_id:string;branches:{name:string}}|null, shiftError: null as unknown,
  set: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), remove: vi.fn(),
}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`);}}));
vi.mock("next/headers",()=>({cookies:async()=>({set:state.set,delete:state.remove})}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:state.user}}),signInWithPassword:state.signIn,signOut:state.signOut},
 from:(table:string)=>{
  const result=()=> table==="profiles" ? {data:state.profile} : table==="role_capabilities" ? {data:state.capabilities} : table==="role_modules" ? {data:state.rules,error:state.rulesError} : table==="branches" ? {data:state.branch} : table==="cashier_shifts" ? {data:state.shift,error:state.shiftError} : {data:state.grants.map(branch_id=>({branch_id}))};
  const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>result(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
  return chain;
 },
})}));
import { pilihCabang } from "@/app/mulai/cabang/actions";
import { login, logout } from "@/app/login/actions";
const form=(mode="klinik",branchId=state.branch.id)=>{const f=new FormData();f.set("mode",mode);f.set("branchId",branchId);return f;};
beforeEach(()=>{
 state.capabilities={all_branches:false,create_accounts:false};state.user={id:"user"};state.profile={role:"STAFF",is_active:true};state.rules=[];state.rulesError=null;
 state.grants=[state.branch.id];state.branch.type="BOTH";state.branch.is_active=true;state.shift=null;state.shiftError=null;
 state.set.mockClear();state.remove.mockClear();state.signIn.mockReset().mockResolvedValue({error:null});state.signOut.mockReset().mockResolvedValue({error:null});
});
describe("selecting operational branches",()=>{
 it.each(["klinik","petshop"])("requires deliberate selection and records only a verified %s branch",async mode=>{
  await expect(pilihCabang(form(mode))).rejects.toThrow(mode==="klinik" ? "REDIRECT:/klinik" : "REDIRECT:/kasir");
  expect(state.set).toHaveBeenCalledWith(`kamo-branch-${mode}`,JSON.stringify({userId:"user",branchId:state.branch.id}),expect.objectContaining({httpOnly:true,sameSite:"lax",path:"/"}));
 });
 it("rejects anonymous submissions",async()=>{state.user=null;await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/login");expect(state.set).not.toHaveBeenCalled();});
 it("rejects a branch outside assignments without writing context",async()=>{state.grants=[];await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai/cabang?");expect(state.set).not.toHaveBeenCalled();});
 it("rejects disabled or wrong-type branches",async()=>{
  state.branch.is_active=false;await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai/cabang?");
  state.branch.is_active=true;state.branch.type="PETSHOP";await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai/cabang?");expect(state.set).not.toHaveBeenCalled();
 });
 it("rejects disabled accounts and denied modules",async()=>{
  state.profile.is_active=false;await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai");
  state.profile.is_active=true;state.rules=[{role:"STAFF",module_id:"crm"}];await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai");expect(state.set).not.toHaveBeenCalled();
 });
 it("fails closed on role or shift read failures",async()=>{
  state.rulesError={message:"failed"};await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai");
  state.rulesError=null;state.shiftError={message:"failed"};await expect(pilihCabang(form())).rejects.toThrow("Shift gagal");expect(state.set).not.toHaveBeenCalled();
 });
 it("blocks switching while another branch has an open shift",async()=>{state.shift={branch_id:"other",branches:{name:"Other"}};await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/mulai/cabang?");expect(state.set).not.toHaveBeenCalled();});
 it("can resume the same shift repeatedly without creating a shift",async()=>{
  state.shift={branch_id:state.branch.id,branches:{name:"A"}};
  for(let i=0;i<5;i++) await expect(pilihCabang(form())).rejects.toThrow("REDIRECT:/klinik");
  expect(state.set).toHaveBeenCalledTimes(5);
 });
 it("rejects arbitrary mode and destination values",async()=>{await expect(pilihCabang(form("https://evil.test"))).rejects.toThrow("REDIRECT:/mulai");expect(state.set).not.toHaveBeenCalled();});
});
describe("session context lifecycle",()=>{
 it("clears previous operational branches after login and lands at mode selection",async()=>{
  const f=new FormData();f.set("email","fictional@test.local");f.set("password","fictional-password");
  await expect(login(f)).rejects.toThrow("REDIRECT:/mulai");expect(state.remove.mock.calls).toEqual([["kamo-branch-klinik"],["kamo-branch-petshop"]]);
 });
 it("keeps failed logins on login",async()=>{state.signIn.mockResolvedValue({error:{message:"Denied"}});await expect(login(new FormData())).rejects.toThrow("REDIRECT:/login?error=Denied");});
 it("clears operational branches on logout",async()=>{await expect(logout()).rejects.toThrow("REDIRECT:/login");expect(state.remove).toHaveBeenCalledTimes(2);expect(state.signOut).toHaveBeenCalledOnce();});
});

describe("all clinic branches", () => {
 it("lets a leader select all branches only with a live role grant", async () => {
  await expect(pilihCabang(form("klinik", "all"))).rejects.toThrow("REDIRECT:/mulai/cabang?");
  expect(state.set).not.toHaveBeenCalled();
  state.capabilities.all_branches = true;
  await expect(pilihCabang(form("klinik", "all"))).rejects.toThrow("REDIRECT:/klinik");
  expect(state.set).toHaveBeenCalledWith("kamo-branch-klinik",JSON.stringify({userId:"user",branchId:"all"}),expect.anything());
 });
 it("requires a concrete branch for petshop and an existing cash shift", async () => {
  state.capabilities.all_branches = true;
  await expect(pilihCabang(form("petshop", "all"))).rejects.toThrow("REDIRECT:/mulai/cabang?");
  state.shift={branch_id:state.branch.id,branches:{name:"A"}};
  await expect(pilihCabang(form("klinik", "all"))).rejects.toThrow("REDIRECT:/mulai/cabang?");
  expect(state.set).not.toHaveBeenCalled();
 });
});
