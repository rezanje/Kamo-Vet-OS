import { expect,it } from "vitest";
import { komisiPeriode } from "../komisi-data";

function client() {
 const tables:Record<string,Record<string,unknown>[]>={
  sales:[{id:"sale",no_struk:"FICT.S04",created_at:"2026-11-12T10:00:00",branch_id:"branch",cashier_id:"cashier",salesperson_id:"cashier",total:1000,
   sale_items:[{id:"line",item_id:null,qty:1,harga:1000,hpp:0,item_discount_type:null,item_discount_value:0,
    service_performers:{version:1,doctor_id:"doctor",staff_id:"staff",doctor_name:"Dr Fiction",staff_name:"Nurse Fiction"}}]}],
  commission_rules:[{id:"global",nama:"Existing 10%",tipe:"persen",basis:"omzet",sumber:"kasir",persen:10,nominal:0,
   employee_id:null,branch_id:null,category_id:null,item_id:null,min_omzet:0,berlaku_dari:null,berlaku_sampai:null,is_active:true}],
  service_commission_policies:[{id:"policy",branch_id:null,effective_from:"2026-11-01",mode:"both_full",
   doctor_share_pct:null,staff_share_pct:null,created_at:"2026-10-26T00:00:00Z"}],
 };
 return {from(table:string){let from=0,to=499;const filters:((row:Record<string,unknown>)=>boolean)[]=[];
  const q={select:()=>q,order:()=>q,not:()=>q,in:()=>q,
   eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},
   neq:(key:string,value:unknown)=>{filters.push(row=>row[key]!==value);return q;},
   is:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},
   gte:(key:string,value:string)=>{filters.push(row=>String(row[key])>=value);return q;},
   lte:(key:string,value:string)=>{filters.push(row=>String(row[key])<=value);return q;},
   range:(start:number,end:number)=>{from=start;to=end;return q;},
   then:(resolve:(result:unknown)=>unknown)=>{const data=(tables[table]??[]).filter(row=>filters.every(filter=>filter(row)));
    return Promise.resolve({data:data.slice(from,to+1),count:data.length,error:null}).then(resolve);}};
  return q;}};
}

it("reads a saved S04 policy with existing rules and keeps the source document once",async()=>{
 const result=await komisiPeriode(client(),"2026-11");
 expect(result.baris).toHaveLength(1);
 expect(result.baris[0]).toMatchObject({sourceLineId:"line",sourceDocumentNumber:"FICT.S04",commissionPending:false,commissionPolicy:"both_full",omzet:1000});
 expect(result.omzetTanpaPenjual).toBe(0);
 expect(result.hasil.map(row=>[row.employeeId,row.komisi]).sort()).toEqual([["doctor",100],["staff",100]]);
});
