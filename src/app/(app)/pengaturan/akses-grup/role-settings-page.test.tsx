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
beforeEach(()=>{state.role="OWNER";state.active=true;state.bad=false;state.rpc.mockReset();state.rpc.mockImplementation(async (_name:string,{p_role}:{p_role:string})=>({data:state.bad?null:{role:p_role,revision:"a".repeat(32),source:"defaults",modules:["klinik"],capabilities:{all_branches:false,create_accounts:false},audit:[],actions:{source:"legacy",allowed:[]},action_catalog:[]},error:null}));});
it("actual page reads consistent snapshot only for supported nonOwner roles and only active Owner edits",async()=>{
 for(const role of ["OWNER","ADMIN","FINANCE","STAFF","DOCTOR"]){state.role=role;const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({peran:"STAFF"})}));expect(html).toContain(`data-edit="${role === "OWNER"}"`);}
 expect(new Set(state.rpc.mock.calls.map(c=>c[1].p_role)).size).toBe(4);
});
it("null config is unknown and no editor is rendered",async()=>{state.bad=true;const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));expect(html).toContain("tidak diketahui");expect(html).not.toContain("EDITOR");});
it("read errors, wrong-role and malformed RPC snapshots disable editor rather than invent defaults",async()=>{
 for(const response of [{data:null,error:{message:"failed"}},{data:{role:"STAFF"},error:null},{data:[],error:null}]){state.rpc.mockResolvedValue(response);const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({peran:"ADMIN"})}));expect(html).toContain("tidak diketahui");expect(html).not.toContain("EDITOR");}
 state.rpc.mockRejectedValue(new Error("transport"));expect(renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}))).not.toContain("EDITOR");
});
it("inactive Owner is not an editor and never reads configuration",async()=>{state.active=false;const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));expect(html).not.toContain("EDITOR");expect(state.rpc).not.toHaveBeenCalled();});
it("never calls unsupported Owner reader; shows static protected Owner status",async()=>{
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({peran:"OWNER"})}));
 expect(state.rpc.mock.calls.some(c=>c[1].p_role==="OWNER")).toBe(false);
 expect(html).toContain("Selalu penuh");
});
