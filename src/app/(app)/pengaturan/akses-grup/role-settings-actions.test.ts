import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), profile: { role: "OWNER", is_active: true }, redirect: vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`); }), revalidate: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner-a" } } }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.profile }) }) }) }), rpc: mocks.rpc }) }));
import { saveRoleSettings, simpanAksesPeran, simpanKemampuanPeran, mulaiAturSendiri, kembalikanBawaan } from "./actions";
import { parseRoleAccessConfig, roleAccessScope, ROLE_ACCESS_CATALOG } from "@/lib/role-access-catalog";
import { MODULES } from "@/lib/nav";
const catalog = [{id:"bank.cash_entry.view_history",label:"Lihat riwayat kas",group:"Kas & Bank",enforced:true},{id:"bank.cash_transfer.create",label:"Buat transfer",group:"Kas & Bank",enforced:false}];
const snapshot = () => ({role:"STAFF",revision,source:"custom",modules:[],capabilities:{all_branches:false,create_accounts:false},audit:[],actions:{source:"custom",allowed:[]},action_catalog:catalog});
const revision = "a".repeat(32), key = "12345678-1234-4123-8123-123456789abc";
function form() { const f = new FormData(); for (const [k,v] of Object.entries({role:"STAFF",expected_revision:revision,requestKey:key,draft_key:key,draft_scope:`role-access:STAFF:${revision}`,mode:"custom",reason:"Pembatasan menu",mod_klinik:"on",all_branches:"on","act_bank.cash_entry.view_history":"on"})) f.set(k,v); return f; }
beforeEach(() => { mocks.rpc.mockReset(); mocks.revalidate.mockReset(); mocks.profile = {role:"OWNER",is_active:true}; mocks.rpc.mockImplementation(async (name:string) => name === "get_role_access_config" ? {data:snapshot(),error:null} : {data:{ role:"STAFF", revision:"b".repeat(32),audit_id:"a1234567-1234-4123-8123-123456789abc",request_key:key,already_applied:false },error:null}); });
it("actual action saves one eight-argument atomic payload and only confirms verified identity", async () => {
 await expect(saveRoleSettings("STAFF",revision,form())).rejects.toThrow("REDIRECT:");
 expect(mocks.rpc).toHaveBeenCalledWith("get_role_access_config",{p_role:"STAFF"});
 expect(mocks.rpc).toHaveBeenCalledWith("save_role_access_config",{p_role:"STAFF",p_expected_revision:revision,p_request_key:key,p_mode:"custom",p_modules:["klinik"],p_capabilities:{all_branches:true,create_accounts:false},p_reason:"Pembatasan menu",p_actions:["bank.cash_entry.view_history"]});
 expect(mocks.redirect).toHaveBeenLastCalledWith(expect.stringContaining(`draft_done=${key}`)); expect(mocks.revalidate).toHaveBeenCalled();
});
it("all other roles and inactive Owner cannot save, Owner target cannot self-lock",async()=>{
 for(const role of ["ADMIN","FINANCE","STAFF","DOCTOR"]){mocks.profile={role,is_active:true};await expect(saveRoleSettings("STAFF",revision,form())).resolves.toMatchObject({ok:false,outcome:"rejected",message:expect.stringContaining("pemilik aktif")});}
 mocks.profile={role:"OWNER",is_active:false};await expect(saveRoleSettings("STAFF",revision,form())).resolves.toMatchObject({ok:false,message:expect.stringContaining("pemilik aktif")});
 mocks.profile.is_active=true;await expect(saveRoleSettings("OWNER",revision,form())).resolves.toMatchObject({ok:false,message:expect.stringContaining("Identitas")});expect(mocks.rpc).not.toHaveBeenCalled();
});
it("forged role/revision/scope, unknown menu and stale backend preserve no acknowledgement",async()=>{
 for(const [field,value] of [["role","ADMIN"],["expected_revision","b".repeat(32)],["draft_scope","role-access:ADMIN:"+revision],["mod_unknown","on"]]){const f=form();f.set(field,value);await expect(saveRoleSettings("STAFF",revision,f)).resolves.toMatchObject({ok:false,outcome:"rejected"});}
 expect(mocks.rpc).not.toHaveBeenCalled();mocks.rpc.mockImplementation(async (name:string) => name === "get_role_access_config" ? {data:snapshot(),error:null} : {data:null,error:{code:"P0001",message:"ROLE_REVISION_CONFLICT"}});await expect(saveRoleSettings("STAFF",revision,form())).resolves.toMatchObject({ok:false,outcome:"rejected",message:expect.stringContaining("Muat ulang")});expect(mocks.revalidate).not.toHaveBeenCalled();
 mocks.rpc.mockImplementation(async (name:string) => name === "get_role_access_config" ? {data:snapshot(),error:null} : {data:null,error:{message:"fetch failed"}});await expect(saveRoleSettings("STAFF",revision,form())).rejects.toThrow("belum terkonfirmasi");expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("reset requires confirmation and resets capabilities too; custom zero menus is allowed",async()=>{
 const f=form();f.set("mode","reset");await expect(saveRoleSettings("STAFF",revision,f)).resolves.toMatchObject({ok:false,message:expect.stringContaining("Konfirmasi")});expect(mocks.rpc).not.toHaveBeenCalled();
 f.set("confirm_reset","on");await expect(saveRoleSettings("STAFF",revision,f)).rejects.toThrow("REDIRECT");expect(mocks.rpc.mock.calls.find(c=>c[0]==="save_role_access_config")![1]).toMatchObject({p_mode:"reset",p_modules:[],p_capabilities:null,p_actions:null});
 const empty=form();empty.delete("mod_klinik");await expect(saveRoleSettings("STAFF",revision,empty)).rejects.toThrow("REDIRECT");expect(mocks.rpc.mock.calls.filter(c=>c[0]==="save_role_access_config").at(-1)![1].p_modules).toEqual([]);
});
it("malformed result never acknowledges or revalidates, replay explicitly reloads current state",async()=>{
 const valid={role:"STAFF",revision:"b".repeat(32),audit_id:key,request_key:key,already_applied:false};
 for(const bad of [null,[],{}, {...valid,role:"ADMIN"},{...valid,request_key:"other"},{...valid,revision:3},{...valid,audit_id:null},{...valid,already_applied:"yes"},{...valid,revision}]){mocks.rpc.mockImplementation(async (name:string) => name === "get_role_access_config" ? {data:snapshot(),error:null} : {data:bad,error:null});await expect(saveRoleSettings("STAFF",revision,form())).rejects.toThrow("belum terkonfirmasi");}
 expect(mocks.revalidate).not.toHaveBeenCalled();mocks.rpc.mockImplementation(async (name:string) => name === "get_role_access_config" ? {data:snapshot(),error:null} : {data:{...valid,already_applied:true},error:null});await expect(saveRoleSettings("STAFF",revision,form())).rejects.toThrow("REDIRECT");expect(decodeURIComponent(mocks.redirect.mock.calls.at(-1)![0].replaceAll("+"," "))).toContain("bukan hasil lama");
});
it("legacy exports deny partial payload with reload and no config writes",async()=>{
 for(const action of [simpanAksesPeran,simpanKemampuanPeran,mulaiAturSendiri,kembalikanBawaan])await expect(action(form())).rejects.toThrow("REDIRECT");expect(mocks.rpc).not.toHaveBeenCalled();
});
it("reader rejects unknown/malformed snapshot instead of defaulting; catalogue derives all source entries",()=>{
 expect(ROLE_ACCESS_CATALOG).toHaveLength(MODULES.length+3);for(const m of MODULES)expect(ROLE_ACCESS_CATALOG.some(c=>c.id===m.id)).toBe(true);
 const v={...snapshot(),role:"STAFF",revision,source:"custom",modules:[],capabilities:{all_branches:false,create_accounts:false},audit:[]};expect(parseRoleAccessConfig(v,"STAFF")).toEqual(v);
 for(const bad of [null,{}, {...v,role:"ADMIN"},{...v,modules:["unknown"]},{...v,revision:"bad"},{...v,capabilities:{}},{...v,audit:[{}]},{...v,modules:["kasir","kasir"]}])expect(parseRoleAccessConfig(bad,"STAFF")).toBeNull();
 expect(roleAccessScope("STAFF",revision)).not.toBe(roleAccessScope("ADMIN",revision));expect(roleAccessScope("STAFF",revision)).not.toBe(roleAccessScope("STAFF","b".repeat(32)));
});
it("rejects unknown, unavailable, duplicate and malformed action choices before any write",async()=>{
 for(const id of ["unknown","bank.cash_transfer.create"]){const f=form();f.set(`act_${id}`,"on");await expect(saveRoleSettings("STAFF",revision,f)).resolves.toMatchObject({ok:false,message:expect.stringContaining("tindakan")});}
 const duplicate=form();duplicate.append("act_bank.cash_entry.view_history","on");await expect(saveRoleSettings("STAFF",revision,duplicate)).resolves.toMatchObject({ok:false,message:expect.stringContaining("tindakan")});
 const bad=form();bad.set("act_bank.cash_entry.view_history","true");await expect(saveRoleSettings("STAFF",revision,bad)).resolves.toMatchObject({ok:false,message:expect.stringContaining("tindakan")});
 expect(mocks.rpc.mock.calls.filter(c=>c[0]==="save_role_access_config")).toHaveLength(0);
});
it("fresh malformed or failed authoritative reads fail closed, empty custom is explicit deny-all",async()=>{
 for(const response of [{data:null,error:{message:"read error"}},{data:{...snapshot(),actions:null},error:null}]){
 mocks.rpc.mockResolvedValue(response);await expect(saveRoleSettings("STAFF",revision,form())).resolves.toMatchObject({ok:false,outcome:"retry",message:expect.stringContaining("dibaca")});}
 expect(mocks.rpc.mock.calls.filter(c=>c[0]==="save_role_access_config")).toHaveLength(0);
 mocks.rpc.mockImplementation(async(name:string)=>name==="get_role_access_config"?{data:snapshot(),error:null}:{data:{role:"STAFF",revision:"b".repeat(32),audit_id:key,request_key:key,already_applied:false},error:null});
 const f=form();f.delete("act_bank.cash_entry.view_history");await expect(saveRoleSettings("STAFF",revision,f)).rejects.toThrow("REDIRECT");expect(mocks.rpc.mock.calls.at(-1)![1].p_actions).toEqual([]);
});
it("does not reject old expected revision before authoritative replay/stale handling",async()=>{
 mocks.rpc.mockImplementation(async(name:string)=>name==="get_role_access_config"?{data:{...snapshot(),revision:"c".repeat(32)},error:null}:{data:{role:"STAFF",revision:"b".repeat(32),audit_id:key,request_key:key,already_applied:true},error:null});
 await expect(saveRoleSettings("STAFF",revision,form())).rejects.toThrow("REDIRECT");expect(mocks.rpc.mock.calls.at(-1)![1]).toMatchObject({p_expected_revision:revision,p_request_key:key});
});
it("a legitimate no-op still acknowledges only a new revision and keeps the submitted draft identity",async()=>{
 const f=form();f.delete("act_bank.cash_entry.view_history");f.delete("mod_klinik");
 await expect(saveRoleSettings("STAFF",revision,f)).rejects.toThrow("REDIRECT");
 const url=new URL(mocks.redirect.mock.calls.at(-1)![0],"http://local");
 expect(url.searchParams.get("draft_scope")).toBe(roleAccessScope("STAFF",revision));expect(url.searchParams.get("draft_done")).toBe(key);
 expect(mocks.rpc.mock.calls.at(-1)![1]).toMatchObject({p_actions:[],p_modules:[],p_expected_revision:revision});
});
