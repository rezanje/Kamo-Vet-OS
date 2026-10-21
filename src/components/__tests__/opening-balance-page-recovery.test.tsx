// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({role:"FINANCE",active:true,params:new URLSearchParams(),recover:vi.fn(async(_data:FormData)=>{})}));
vi.mock("next/navigation",()=>({useSearchParams:()=>state.params}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("@/app/(app)/keuangan/saldo-awal/actions",()=>({pulihkanSaldoAwal:state.recover,bacaSaldoAwal:vi.fn(async()=>({usulan:[],akun:[],barisAktif:[],sudahAda:state.active?{id:"committed",no_jurnal:"JRN-FIXTURE",tanggal:"2026-10-20"}:null}))}));
vi.mock("@/app/(app)/keuangan/saldo-awal/SaldoAwalForm",()=>({SaldoAwalForm:()=> <div data-testid="opening-editor"/>,BatalSaldoAwalForm:()=> <div data-testid="void-editor"/>}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:"owner"}}})},rpc:async()=>({data:true,error:null}),from:()=>{const q={select:()=>q,eq:()=>q,order:()=>q,maybeSingle:async()=>({data:{role:state.role,is_active:true}}),limit:async()=>({data:[]})};return q;}})}));
import Page from "@/app/(app)/keuangan/saldo-awal/page";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});sessionStorage.clear();state.params=new URLSearchParams();state.recover.mockClear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it.each([['FINANCE',true,'opening-balance-create'],['OWNER',false,'opening-balance-void-committed']] as const)("recovers committed %s request after lost response and reload",async(role,active,scope)=>{
 state.role=role;state.active=active;
 const storage=`vetos:correction-key:v1:owner:${scope}`,draft=`vetos:transaction-draft:v1:owner:transaction:${scope}`;
 sessionStorage.setItem(storage,"pending-key");sessionStorage.setItem(draft,JSON.stringify({version:1,savedAt:Date.now(),requestKey:"pending-key",fields:{},snapshot:{}}));
 await act(async()=>root.render(await Page({searchParams:Promise.resolve({})})));
 expect(host.querySelector('[data-testid="void-editor"]')).toBeNull();
 if(role==="FINANCE")expect(host.querySelector('[data-testid="opening-editor"]')).toBeNull();
 await act(async()=>host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(state.recover).toHaveBeenCalledTimes(1);expect(state.recover.mock.calls[0][0].get("draft_key")).toBe("pending-key");
 expect(sessionStorage.getItem(draft)).not.toBeNull();
 state.params=new URLSearchParams({draft_scope:scope,draft_done:"pending-key"});
 await act(async()=>root.render(await Page({searchParams:Promise.resolve({success:"confirmed"})})));
 expect(sessionStorage.getItem(storage)).toBeNull();expect(sessionStorage.getItem(draft)).toBeNull();
});
