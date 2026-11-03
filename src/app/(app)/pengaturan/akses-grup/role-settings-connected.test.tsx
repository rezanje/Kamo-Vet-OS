// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), params: "", redirects: [] as string[] }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.params), redirect: (url:string) => {state.redirects.push(url);throw new Error("redirect captured");} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth:{getUser:async()=>({data:{user:{id:"owner"}},error:null})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:"OWNER",is_active:true},error:null})})})}),rpc:state.rpc }) }));
import { NewRoleSettingsForm } from "./newRoleSettingsForm";
import { roleAccessScope, type RoleAccessConfig } from "@/lib/role-access-catalog";
const config:RoleAccessConfig={role:"STAFF",revision:"a".repeat(32),source:"custom",modules:[],capabilities:{all_branches:false,create_accounts:false},audit:[],actions:{source:"custom",allowed:[]},action_catalog:[{id:"bank.cash_entry.view_history",group:"Kas & Bank",label:"Lihat riwayat kas",enforced:true}]};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();state.params="";state.redirects=[];state.rpc.mockReset();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("real form binds actual action; stale and uncertain replies keep action draft and replay identity",async()=>{
 state.rpc.mockImplementation(async(name:string)=>name==="get_role_access_config"?{data:config,error:null}:{data:null,error:{code:"P0001",message:"ROLE_REVISION_CONFLICT"}});
 await act(async()=>root.render(<NewRoleSettingsForm userId="owner" config={config} canEdit />));
 const key=host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value;
 await act(async()=>{host.querySelector<HTMLInputElement>('[name="act_bank.cash_entry.view_history"]')!.click();const reason=host.querySelector<HTMLTextAreaElement>('[name="reason"]')!;reason.value="Izin riwayat";reason.dispatchEvent(new Event("input",{bubbles:true}));});
 const submit=async()=>act(async()=>{host.querySelector('form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
 await submit();expect(host.textContent).toContain("Muat ulang");expect(host.textContent).not.toContain("belum terkonfirmasi");
 expect(state.rpc.mock.calls.at(-1)![1]).toMatchObject({p_role:"STAFF",p_actions:["bank.cash_entry.view_history"],p_expected_revision:config.revision,p_request_key:key});
 state.rpc.mockImplementation(async(name:string)=>name==="get_role_access_config"?{data:config,error:null}:{data:{bad:"uncertain"},error:null});
 await submit();expect(host.textContent).toContain("belum terkonfirmasi");expect(state.redirects).toHaveLength(0);
 await act(async()=>root.unmount());root=createRoot(host);
 await act(async()=>root.render(<NewRoleSettingsForm userId="owner" config={config} canEdit />));
 expect(host.querySelector<HTMLInputElement>('[name="requestKey"]')!.value).toBe(key);expect(host.querySelector<HTMLInputElement>('[name="act_bank.cash_entry.view_history"]')!.checked).toBe(true);
 state.rpc.mockImplementation(async(name:string)=>name==="get_role_access_config"?{data:{...config,revision:"c".repeat(32)},error:null}:{data:{role:"STAFF",revision:"b".repeat(32),audit_id:key,request_key:key,already_applied:true},error:null});
 await submit();const url=new URL(state.redirects[0],"http://local");expect(url.searchParams.get("draft_done")).toBe(key);expect(url.searchParams.get("draft_scope")).toBe(roleAccessScope("STAFF",config.revision));expect(url.searchParams.get("success")).toContain("bukan hasil lama");
 // Emulate the router receiving the exact server-generated acknowledgement, not Auth/browser UAT.
 state.params=url.search.slice(1);
 await act(async()=>root.render(<NewRoleSettingsForm userId="owner" config={config} canEdit />));
 expect(sessionStorage.getItem(`vetos:correction-key:v1:owner:${roleAccessScope("STAFF",config.revision)}`)).not.toBe(key);
});
