import { beforeEach, expect, it, vi } from "vitest";

const state=vi.hoisted(()=>({inserted:[] as Record<string,unknown>[]}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw Error(`REDIRECT:${url}`);}}));
vi.mock("@/lib/master-guard",()=>({assertMasterAdmin:async()=>({from:(table:string)=>{
  if(table!=="service_commission_policies")throw Error(`Unexpected table ${table}`);
  return {insert:async(row:Record<string,unknown>)=>{state.inserted.push(row);return {error:null};}};
}})}));
import { simpanKebijakanKomisiJasa } from "@/app/(app)/penjualan/komisi/actions";

const form=(values:Record<string,string>)=>{
 const data=new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;
};
beforeEach(()=>{state.inserted=[];});

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
});
