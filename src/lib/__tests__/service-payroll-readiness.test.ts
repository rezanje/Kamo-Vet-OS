import {expect,it,vi} from "vitest";
vi.mock("../payroll-aturan",()=>({getAturanGaji:async()=>({})}));
vi.mock("../komisi-data",()=>({komisiPeriode:async()=>({hasil:[],baris:[{commissionPending:true,fixedCommission:false}]})}));
import {assertServiceAttributionReady} from "../commission-readiness";
import {kumpulkanDataGaji} from "../payroll-data";
it("allows legacy and the already-posted DEMO pool without inventing new payout policy",()=>{
 expect(()=>assertServiceAttributionReady([{}, {commissionPending:true,fixedCommission:true}])).not.toThrow();
});
it("stops payroll calculation before unresolved two-person service commission can be silently omitted",async()=>{
 const reads:string[]=[];const client={from(table:string){reads.push(table);const q={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:[],count:0,error:null})};return q;}};
 await expect(kumpulkanDataGaji(client,"2026-10")).rejects.toThrow("SERVICE_ATTRIBUTION_PENDING:");
 expect(reads).toEqual(["employees"]);
});
