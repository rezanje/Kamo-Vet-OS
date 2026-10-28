import { beforeEach, expect, it, vi } from "vitest";

const state=vi.hoisted(()=>({inserted:[] as Record<string,unknown>[],error:null as null|{code:string;message:string},roles:[] as string[][]}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/master-guard",()=>({assertRole:async(_back:string,_what:string,roles:string[])=>{state.roles.push(roles);return {from:(table:string)=>{
  if(table!=="service_commission_policies")throw Error(`Unexpected table ${table}`);
  return {insert:async(row:Record<string,unknown>)=>{state.inserted.push(row);return {error:state.error};}};
}};}}));
import { simpanKebijakanKomisiJasa } from "@/app/(app)/penjualan/komisi/actions";

const form=(values:Record<string,string>)=>{
 const data=new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;
};
beforeEach(()=>{state.inserted=[];state.error=null;state.roles=[];});

it("rejects an absent choice, invalid date, and accidental or nonconserving shares before any write",async()=>{
 const base={mode:"split",effective_from:"2026-11-01",doctor_share_pct:"60",staff_share_pct:"40"};
 for(const values of [
  {...base,mode:""}, {...base,effective_from:"2026-11-31"},
  {...base,staff_share_pct:"30"}, {...base,doctor_share_pct:"60.001",staff_share_pct:"39.999"},
  {...base,mode:"both_full"},
 ])await expect(simpanKebijakanKomisiJasa(form(values))).rejects.toThrow("REDIRECT:/penjualan/komisi?error=");
 expect(state.inserted).toHaveLength(0);
});

it("stores only the explicit choice and shares, retaining server-owned audit fields",async()=>{
 await expect(simpanKebijakanKomisiJasa(form({mode:"split",effective_from:"2026-11-01",branch_id:"fb100000-0000-4000-8000-000000000001",
  doctor_share_pct:"62.5",staff_share_pct:"37.5"}))).rejects.toThrow("REDIRECT:/penjualan/komisi?success=1");
 expect(state.inserted).toEqual([{branch_id:"fb100000-0000-4000-8000-000000000001",effective_from:"2026-11-01",mode:"split",
  doctor_share_pct:62.5,staff_share_pct:37.5}]);
});

it("saves an explicit pending choice to pause an earlier policy",async()=>{
 await expect(simpanKebijakanKomisiJasa(form({mode:"pending",effective_from:"2026-12-01"})))
  .rejects.toThrow("REDIRECT:/penjualan/komisi?success=1");
 expect(state.inserted).toEqual([{branch_id:null,effective_from:"2026-12-01",mode:"pending",doctor_share_pct:null,staff_share_pct:null}]);
 expect(state.roles).toEqual([["OWNER"]]);
});

it("explains a missing policy table instead of showing a raw database error",async()=>{
 state.error={code:"PGRST205",message:"Could not find the table in the schema cache"};
 await expect(simpanKebijakanKomisiJasa(form({mode:"pending",effective_from:"2026-12-01"})))
  .rejects.toThrow(encodeURIComponent("Penyimpanan kebijakan komisi jasa belum terpasang di database. Hubungi pengelola rilis."));
});
