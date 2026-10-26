import { expect,it } from "vitest";
import { hitungKomisi, type AturanKomisi, type BarisJual } from "../komisi";
import { assertServiceAttributionReady } from "../commission-readiness";
import { prepareServiceCommission, type ServiceCommissionPolicy } from "../service-commission-policy";

const source:BarisJual={tanggal:"2026-11-12",sumber:"klinik",employeeId:null,branchId:"branch",
 itemId:null,kategoriIds:[],qty:1,omzet:1000,laba:1000,commissionPending:true,sourceLineId:"saved-line",
 servicePerformers:{version:1,doctor_id:"doctor",staff_id:"staff",doctor_name:"Dr Fiction",staff_name:"Nurse Fiction"}};
const rule=(id:string,employeeId:string|null,percent=10):AturanKomisi=>({id,nama:id,tipe:"persen",basis:"omzet",sumber:"klinik",
 persen:percent,nominal:0,employeeId,branchId:null,categoryId:null,itemId:null,minOmzet:0,dari:null,sampai:null});
const policy=(mode:ServiceCommissionPolicy["mode"],changes:Partial<ServiceCommissionPolicy>={}):ServiceCommissionPolicy=>({
 id:"policy",branchId:null,effectiveFrom:"2026-11-01",mode,doctorSharePct:mode==="split"?60:null,
 staffSharePct:mode==="split"?40:null,createdAt:"2026-10-26T00:00:00Z",...changes,
});

it("keeps a two-person source pending, once for revenue, until an explicit policy is saved",()=>{
 const prepared=prepareServiceCommission([source],[rule("global",null)],[]);
 expect(prepared.rows).toHaveLength(1);expect(prepared.calculationRows).toHaveLength(1);
 expect(prepared.rows[0].commissionPending).toBe(true);
 expect(()=>assertServiceAttributionReady(prepared.rows)).toThrow("SERVICE_ATTRIBUTION_PENDING");
});

it("requires personal rules for both actors and excludes a global rule",()=>{
 const missing=prepareServiceCommission([source],[rule("global",null),rule("doctor", "doctor")],[policy("personal_rules")]);
 expect(missing.rows[0]).toMatchObject({commissionPending:true,commissionPolicyWarning:expect.any(String)});
 const configured=prepareServiceCommission([source],[rule("global",null),rule("doctor","doctor"),rule("staff","staff",5)],[policy("personal_rules")]);
 expect(configured.rows).toHaveLength(1);expect(configured.rows[0].commissionPending).toBe(false);
 expect(configured.calculationRows.map(row=>row.employeeId)).toEqual(["doctor","staff"]);
 expect(hitungKomisi(configured.calculationRows,[rule("global",null),rule("doctor","doctor"),rule("staff","staff",5)]).map(row=>row.komisi)).toEqual([100,50]);
 expect(()=>assertServiceAttributionReady(configured.rows)).not.toThrow();
});

it("applies full existing rules to both only when full basis was chosen",()=>{
 const configured=prepareServiceCommission([source],[rule("global",null)],[policy("both_full")]);
 expect(configured.rows.reduce((sum,row)=>sum+row.omzet,0)).toBe(1000);
 expect(configured.resolvedUnassignedOmzet).toBe(1000);
 expect(hitungKomisi(configured.calculationRows,[rule("global",null)]).map(row=>row.komisi)).toEqual([100,100]);
});

it("splits an explicitly configured basis, retaining exact source revenue and negative return sign",()=>{
 const ret={...source,tanggal:"2026-12-03",commissionPolicyDate:"2026-11-12",qty:-1,omzet:-100,laba:-100};
 const configured=prepareServiceCommission([source,ret],[rule("global",null)],[policy("split")]);
 expect(configured.rows.map(row=>row.omzet)).toEqual([1000,-100]);
 expect(configured.calculationRows.map(row=>row.omzet)).toEqual([600,400,-60,-40]);
 expect(configured.calculationRows.map(row=>row.qty)).toEqual([0.6,0.4,-0.6,-0.4]);
 expect(configured.resolvedUnassignedOmzet).toBe(900);
 expect(hitungKomisi(configured.calculationRows,[rule("global",null)]).map(row=>row.komisi)).toEqual([54,36]);
});

it("uses a branch choice ahead of a global choice and fails closed on invalid settings",()=>{
 const global=policy("both_full",{id:"global",effectiveFrom:"2026-11-10"});
 const branch=policy("split",{id:"branch",branchId:"branch",effectiveFrom:"2026-11-01",doctorSharePct:25,staffSharePct:75});
 const configured=prepareServiceCommission([source],[rule("global",null)],[global,branch]);
 expect(configured.calculationRows.map(row=>row.omzet)).toEqual([250,750]);
 const bad=prepareServiceCommission([source],[rule("global",null)],[{...branch,staffSharePct:70}]);
 expect(bad.rows[0].commissionPending).toBe(true);
});

it("never replaces a DEMO snapshot or an ambiguous return source",()=>{
 const ambiguous={...source,servicePerformers:undefined,sourceLineId:undefined};
 const prepared=prepareServiceCommission([{...source,fixedCommission:true},ambiguous],[rule("global",null)],[policy("both_full")]);
 expect(prepared.calculationRows).toHaveLength(2);
 expect(prepared.rows[0].fixedCommission).toBe(true);
 expect(prepared.rows[1].commissionPending).toBe(true);
});
