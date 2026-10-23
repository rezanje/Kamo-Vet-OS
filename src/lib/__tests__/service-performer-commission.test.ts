import { expect,it } from "vitest";
import { kumpulkanBarisKomisi } from "../komisi-data";
import { hitungKomisi,realisasiTarget,type AturanKomisi } from "../komisi";
function client() {
 const source=[{id:"a",item_id:"service",qty:1,harga:100,hpp:0,service_performers:{version:1,doctor_id:"doctor",staff_id:null,doctor_name:"Historical vet"}},
 {id:"b",item_id:"service",qty:1,harga:100,hpp:0,service_performers:{version:1,doctor_id:null,staff_id:"groomer",staff_name:"Historical groomer"}},
 {id:"c",item_id:"service",qty:1,harga:100,hpp:0,service_performers:{version:1,doctor_id:"doctor",staff_id:"groomer",doctor_name:"Historical vet",staff_name:"Historical groomer"}}];
 return {from(table:string){const data=table==="sales"?[{id:"sale",no_struk:"FICT-1",created_at:"2026-10-23",branch_id:"branch",salesperson_id:"cashier",cashier_id:"profile",total:300,sale_items:source}]
 :table==="sales_returns"?[{id:"return",sale_id:"sale",tanggal:"2026-10-23",sales_return_items:[{source_line_id:"b",item_id:"service",qty:1,harga:100}]}]:[];
 const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,in:()=>q,order:()=>q,range:async()=>({data,count:data.length,error:null}),then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data,count:data.length,error:null}).then(resolve)};return q;}};
}
const rule:AturanKomisi={id:"existing",nama:"Existing",tipe:"persen",basis:"omzet",sumber:"kasir",persen:10,nominal:0,employeeId:null,branchId:null,categoryId:null,itemId:null,minOmzet:0,dari:null,sampai:null};
it("uses each saved service performer rather than the cashier and preserves exact return source",async()=>{
 const result=await kumpulkanBarisKomisi(client(),"2026-10");
 expect(result.baris.map(row=>row.employeeId)).toEqual(["doctor","groomer",null,"groomer"]);
 expect(result.baris.map(row=>row.omzet)).toEqual([100,100,100,-100]);
 expect(result.baris[1]).toMatchObject({sourceLineId:"b",sourceDocumentId:"sale",servicePerformers:{staff_name:"Historical groomer"}});
 expect(result.baris[3]).toMatchObject({sourceLineId:"b",employeeId:"groomer"});
 const commissions=hitungKomisi(result.baris,[rule]);expect(commissions.find(row=>row.employeeId==="doctor")?.komisi).toBe(10);
 expect(commissions.find(row=>row.employeeId==="groomer")?.komisi).toBe(0);expect(commissions.some(row=>row.employeeId==="cashier")).toBe(false);
});
it("retains a two-performer service once for branch revenue and flags the unresolved payout instead of multiplying it",async()=>{
 const result=await kumpulkanBarisKomisi(client(),"2026-10");expect(result.baris[2]).toMatchObject({commissionPending:true,employeeId:null,sourceLineId:"c"});
 expect(realisasiTarget(result.baris,{id:"target",employeeId:null,branchId:"branch",categoryId:null,basis:"omzet",target:200}).realisasi).toBe(200);
});
