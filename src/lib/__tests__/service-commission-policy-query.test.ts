import { expect,it } from "vitest";
import { komisiPeriode, muatKebijakanKomisiJasa } from "../komisi-data";
import { assertServiceAttributionReady } from "../commission-readiness";

function client(options:{policyError?:{code:string;message:string};singleOnly?:boolean}={}) {
 const tables:Record<string,Record<string,unknown>[]>={
  sales:[...(options.singleOnly?[]:[{id:"sale",no_struk:"FICT.S04",created_at:"2026-11-12T10:00:00",branch_id:"branch",cashier_id:"cashier",salesperson_id:"cashier",total:1000,
   sale_items:[{id:"line",item_id:null,qty:1,harga:1000,hpp:0,item_discount_type:null,item_discount_value:0,
    service_performers:{version:1,doctor_id:"doctor",staff_id:"staff",doctor_name:"Dr Fiction",staff_name:"Nurse Fiction"}}]}]),
   {id:"single",no_struk:"FICT.S04.ONE",created_at:"2026-11-13T10:00:00",branch_id:"branch",cashier_id:"cashier",salesperson_id:"cashier",total:500,
   sale_items:[{id:"one",item_id:null,qty:1,harga:500,hpp:0,item_discount_type:null,item_discount_value:0,
    service_performers:{version:1,doctor_id:"doctor",staff_id:null,doctor_name:"Dr Fiction",staff_name:null}}]}],
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
   then:(resolve:(result:unknown)=>unknown)=>{
    if(table==="service_commission_policies"&&options.policyError)return Promise.resolve({data:null,count:null,error:options.policyError}).then(resolve);
    const data=(tables[table]??[]).filter(row=>filters.every(filter=>filter(row)));
    return Promise.resolve({data:data.slice(from,to+1),count:data.length,error:null}).then(resolve);}};
  return q;}};
}

it("reads a saved S04 policy with existing rules and keeps the source document once",async()=>{
 const result=await komisiPeriode(client(),"2026-11");
 expect(result.baris).toHaveLength(2);
 expect(result.baris.find(row=>row.sourceLineId==="line")).toMatchObject({sourceLineId:"line",sourceDocumentNumber:"FICT.S04",commissionPending:false,commissionPolicy:"both_full",omzet:1000});
 expect(result.omzetTanpaPenjual).toBe(0);
 expect(result.hasil.map(row=>[row.employeeId,row.komisi]).sort()).toEqual([["doctor",150],["staff",100]]);
 expect(()=>assertServiceAttributionReady(result.baris)).not.toThrow();
});

it.each(["PGRST205","42P01"])("before the S04 migration (%s) keeps two-performer rows pending and blocks payroll, while other rows still calculate",async code=>{
 const result=await komisiPeriode(client({policyError:{code,message:"fictional missing table"}}),"2026-11");
 expect(result.baris.find(row=>row.sourceLineId==="line")).toMatchObject({commissionPending:true,omzet:1000});
 expect(result.baris.find(row=>row.sourceLineId==="one")).toMatchObject({employeeId:"doctor",omzet:500});
 expect(result.hasil.map(row=>[row.employeeId,row.komisi])).toEqual([["doctor",50]]);
 expect(()=>assertServiceAttributionReady(result.baris)).toThrow(/belum lengkap/);
 const singles=await komisiPeriode(client({policyError:{code,message:"fictional missing table"},singleOnly:true}),"2026-11");
 expect(()=>assertServiceAttributionReady(singles.baris)).not.toThrow();
 await expect(muatKebijakanKomisiJasa(client({policyError:{code,message:"fictional"}}))).resolves.toEqual({policies:[],installed:false});
});

it("any other policy read failure stays fatal instead of reading as no policy",async()=>{
 await expect(komisiPeriode(client({policyError:{code:"42501",message:"fictional permission denied"}}),"2026-11")).rejects.toThrow(/permission denied/);
 await expect(muatKebijakanKomisiJasa(client({policyError:{code:"PGRST301",message:"fictional jwt"}}))).rejects.toThrow(/jwt/);
});

it("maps stored numeric shares and leaves policies after the period out",async()=>{
 const loaded=await muatKebijakanKomisiJasa(client(),"2026-10-31");
 expect(loaded).toEqual({installed:true,policies:[]});
 expect((await muatKebijakanKomisiJasa(client())).policies).toEqual([{id:"policy",branchId:null,effectiveFrom:"2026-11-01",mode:"both_full",
  doctorSharePct:null,staffSharePct:null,createdAt:"2026-10-26T00:00:00Z"}]);
});
