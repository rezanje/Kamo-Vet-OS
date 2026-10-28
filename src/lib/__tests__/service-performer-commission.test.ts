import { expect,it } from "vitest";
import { kumpulkanBarisKomisi } from "../komisi-data";
import { hitungKomisi,realisasiTarget,type AturanKomisi } from "../komisi";
import { prepareServiceCommission, type ServiceCommissionPolicy } from "../service-commission-policy";
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
it("attributes clinic SKU revenue to its saved line seller while retaining the existing service performer rule",async()=>{
 const invoice={id:"clinic",invoice_no:"FICT-CLINIC",visit_id:"visit",paid_at:"2026-10-23T10:00:00Z",total:400,salesperson_id:"header",
  visits:{branch_id:"branch",doctor_id:"doctor"},invoice_items:[
   {id:"med",item_id:"medicine",qty:1,harga:100,hpp:10,salesperson_id:"line-medicine",service_performers:null},
   {id:"legacy",item_id:"medicine",qty:1,harga:100,hpp:10,salesperson_id:null,service_performers:null},
   {id:"procedure",item_id:"service",qty:1,harga:100,hpp:0,salesperson_id:"line-procedure",service_performers:{version:1,doctor_id:"performer",staff_id:null}},
   {id:"procedure-no-performer",item_id:"service",qty:1,harga:100,hpp:0,salesperson_id:"line-service",service_performers:null},
  ]};
 const fake={from(table:string){const data=table==="invoices"?[invoice]:[];
  const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,in:()=>q,order:()=>q,
   range:async()=>({data,count:data.length,error:null}),then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data,count:data.length,error:null}).then(resolve)};return q;}};
 const result=await kumpulkanBarisKomisi(fake,"2026-10");
 expect(result.baris.map(row=>row.employeeId)).toEqual(["line-medicine","header","performer","line-service"]);
 expect(result.baris.map(row=>row.omzet)).toEqual([100,100,100,100]);
});
it("J03: a clinic refund reduces the original line owner's revenue in the refund period",async()=>{
 const invoice={id:"clinic",invoice_no:"FICT-CLINIC",visit_id:"visit",paid_at:"2026-09-20T10:00:00Z",total:200,salesperson_id:"header",
  visits:{branch_id:"branch",doctor_id:"doctor"},invoice_items:[
   {id:"med",item_id:"medicine",qty:2,harga:50,hpp:20,salesperson_id:"line-medicine",service_performers:null},
   {id:"svc",item_id:null,qty:1,harga:100,hpp:null,salesperson_id:null,service_performers:null}]};
 const refund={id:"rf",invoice_id:"clinic",tanggal:"2026-10-05",clinic_refund_items:[{invoice_item_id:"med",qty:1},{invoice_item_id:"svc",qty:1}]};
 const fake={from(table:string){const data=table==="invoices"?[invoice]:table==="clinic_refunds"?[refund]:[];
  const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,in:()=>q,order:()=>q,
   range:async()=>({data,count:data.length,error:null}),then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data,count:data.length,error:null}).then(resolve)};return q;}};
 const result=await kumpulkanBarisKomisi(fake,"2026-10");
 const refunds=result.baris.filter(row=>row.omzet<0);
 expect(refunds).toEqual([
  expect.objectContaining({tanggal:"2026-10-05",commissionPolicyDate:"2026-09-20",employeeId:"line-medicine",qty:-1,omzet:-50,laba:-40,sumber:"klinik"}),
  expect.objectContaining({tanggal:"2026-10-05",employeeId:"header",qty:-1,omzet:-100,laba:-100}),
 ]);
});
it("J03: commission still reads when the clinic refund table is not installed yet",async()=>{
 const fake={from(table:string){const missing=table==="clinic_refunds";const data:unknown[]=[];
  const result=missing?{data:null,count:null,error:{code:"PGRST205",message:"missing"}}:{data,count:0,error:null};
  const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,in:()=>q,order:()=>q,
   range:async()=>result,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return q;}};
 await expect(kumpulkanBarisKomisi(fake,"2026-10")).resolves.toMatchObject({baris:[]});
});
it("J03: reads refunded invoices from earlier periods in bounded id batches",async()=>{
 const refunds=Array.from({length:450},(_,n)=>({id:`rf${n}`,invoice_id:`old${n}`,tanggal:"2026-10-05",clinic_refund_items:[]}));
 const batches:number[]=[];
 const fake={from(table:string){let data:unknown[]=table==="clinic_refunds"?refunds:[];
  const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,order:()=>q,
   in:(_c:string,ids:string[])=>{batches.push(ids.length);data=[];return q;},
   range:async()=>({data,count:data.length,error:null}),then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data,count:data.length,error:null}).then(resolve)};return q;}};
 await kumpulkanBarisKomisi(fake,"2026-10");
 expect(batches).toEqual([200,200,50]);
});

// Atribusi per baris berlaku untuk barang biasa juga, bukan cuma jasa (permintaan Andri).
it("pays an ordinary goods line to its own doctor and non-doctor, splitting by the service commission policy",async()=>{
 const invoice={id:"clinic",invoice_no:"FICT-GOODS",visit_id:"visit",paid_at:"2026-10-23T10:00:00Z",total:300,salesperson_id:null,
  visits:{branch_id:"branch",doctor_id:"visit-doctor"},invoice_items:[
   {id:"food",item_id:"medicine",qty:1,harga:100,hpp:40,salesperson_id:null,
    service_performers:{version:1,doctor_id:"doctor",staff_id:null,doctor_name:"Historical vet"}},
   {id:"shampoo",item_id:"medicine",qty:1,harga:100,hpp:40,salesperson_id:null,
    service_performers:{version:1,doctor_id:"doctor",staff_id:"groomer",doctor_name:"Historical vet",staff_name:"Historical groomer"}},
   {id:"legacy",item_id:"medicine",qty:1,harga:100,hpp:40,salesperson_id:null,service_performers:null},
  ]};
 const fake={from(table:string){const data=table==="invoices"?[invoice]:[];
  const q={select:()=>q,eq:()=>q,is:()=>q,not:()=>q,neq:()=>q,gte:()=>q,lte:()=>q,in:()=>q,order:()=>q,
   range:async()=>({data,count:data.length,error:null}),then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data,count:data.length,error:null}).then(resolve)};return q;}};
 const result=await kumpulkanBarisKomisi(fake,"2026-10");
 // Baris lama (tanpa atribusi) tetap jatuh ke dokter PJ kunjungan seperti sebelum fitur ini.
 expect(result.baris.map(row=>row.employeeId)).toEqual(["doctor",null,"visit-doctor"]);
 expect(result.baris[1]).toMatchObject({commissionPending:true,sourceLineId:"shampoo",servicePerformers:{staff_name:"Historical groomer"}});
 const clinicRule:AturanKomisi={...rule,id:"clinic-rule",sumber:"klinik"};
 const policy:ServiceCommissionPolicy={id:"policy",branchId:null,effectiveFrom:"2026-01-01",mode:"split",doctorSharePct:60,staffSharePct:40,createdAt:"2026-01-01T00:00:00Z"};
 const {calculationRows}=prepareServiceCommission(result.baris,[clinicRule],[policy]);
 expect(calculationRows.filter(row=>row.sourceLineId==="shampoo").map(row=>[row.employeeId,row.omzet]))
  .toEqual([["doctor",60],["groomer",40]]);
});
