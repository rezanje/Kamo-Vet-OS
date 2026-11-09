import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role:"OWNER", active:true, bad:false, rpc:vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({auth:{getUser:async()=>({data:{user:{id:"actor"}}})},rpc:state.rpc,from:(table:string)=>({select:()=>table === "profiles" ? {eq:()=>({maybeSingle:async()=>({data:{role:state.role,is_active:state.active}})}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({data:[]}))} : {eq:()=>({maybeSingle:async()=>({data:null})}),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(resolve({data:[]}))}})}) }));
vi.mock("./newRoleSettingsForm",()=>({NewRoleSettingsForm:({canEdit,config}:{canEdit:boolean;config:{role:string}})=><div data-edit={String(canEdit)}>EDITOR {config.role}</div>}));
vi.mock("@/components/MasterPage",()=>({MasterPage:({children}:{children:React.ReactNode})=><main>{children}</main>}));
vi.mock("@/components/SecHeader",()=>({SecHeader:()=>null}));
vi.mock("@/components/LocalTransactionDraft",()=>({TransactionDraftComplete:()=>null}));
import Page from "./page";
beforeEach(()=>{state.role="OWNER";state.active=true;state.bad=false;state.rpc.mockReset();state.rpc.mockImplementation(async (_name:string,{p_role}:{p_role:string})=>({data:state.bad?null:{role:p_role,revision:"a".repeat(32),source:"defaults",modules:["klinik"],...(p_role==="ADMIN"?{submenus:{klinik:["klinik.antrian","klinik.registrasi"]}}:{}),capabilities:{all_branches:false,create_accounts:false},audit:[],actions:{source:"legacy",allowed:[]},action_catalog:[]},error:null}));});
it("role summary table states which modules are restricted to how many sub-menus (ADMIN) and 'semua' otherwise",async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({peran:"ADMIN"})}));
 expect(html).toContain("Sub-menu");
 expect(html).toMatch(/Klinik: 2 dari \d+ sub-menu/);
 expect(html).toContain("Semua sub-menu");
});
