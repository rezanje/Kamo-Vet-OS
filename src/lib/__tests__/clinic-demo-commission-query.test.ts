import { describe, expect, it } from "vitest";
import { komisiPeriode } from "../komisi-data";

type Row = Record<string, unknown>;
function client(reissued = false) {
  const invoice = {id:"invoice",paid_at:reissued ? "2026-12-01T10:00:00" : "2026-10-12T10:00:00",paid_status:"Lunas",voided_at:null,total:50500,salesperson_id:"doctor",
    visits:{branch_id:"branch",doctor_id:"doctor"},invoice_items:[{item_id:null,qty:1,harga:50000,hpp:0}],clinic_demo_invoice_snapshots:{invoice_id:"invoice"}};
  const tables: Record<string, Row[]> = {
    invoices:[invoice],
    clinic_demo_incentive_allocations:["doctor","nurse"].map(employee_id=>({id:employee_id,invoice_id:"invoice",employee_id,amount:1250,
      clinic_demo_invoice_snapshots:{service_basis:50000,earned_at:"2026-10-12T10:00:00"},invoices:invoice})),
    commission_rules:[{id:"legacy",nama:"Legacy 10%",tipe:"persen",basis:"omzet",sumber:"klinik",persen:10,nominal:0,employee_id:null,branch_id:null,category_id:null,item_id:null,min_omzet:0,berlaku_dari:null,berlaku_sampai:null,is_active:true}],
  };
  return {from(table:string) {
    let fields=""; let from=0; let to=499; const filters: ((row:Row)=>boolean)[]=[];
    const value=(row:Row,key:string)=>key.split(".").reduce<unknown>((node,part)=>node && typeof node==="object" ? (node as Row)[part] : undefined,row);
    const q={
      select(text:string){fields=text;return q;},order:()=>q,not:()=>q,in:()=>q,
      eq(key:string,v:unknown){filters.push(row=>value(row,key)===v);return q;},
      neq(key:string,v:unknown){filters.push(row=>value(row,key)!==v);return q;},
      is(key:string,v:unknown){filters.push(row=>value(row,key)===v);return q;},
      gte(key:string,v:string){filters.push(row=>String(value(row,key))>=v);return q;},
      lte(key:string,v:string){filters.push(row=>String(value(row,key))<=v);return q;},
      range(a:number,b:number){from=a;to=b;return q;},
      then(resolve:(result:unknown)=>unknown){
        // PostgREST exposes both the direct FK and an inferred relationship;
        // reproduce its real PGRST201 response for an unqualified embed.
        if(table==="invoices" && fields.includes("clinic_demo_invoice_snapshots(invoice_id)")) return Promise.resolve({data:null,count:null,error:{message:"Could not embed because more than one relationship was found for invoices and clinic_demo_invoice_snapshots"}}).then(resolve);
        const rows=(tables[table] ?? []).filter(row=>filters.every(f=>f(row)));
        return Promise.resolve({data:rows.slice(from,to+1),count:rows.length,error:null}).then(resolve);
      },
    };return q;
  }};
}

describe("clinic DEMO commission relational reads",()=>{
  it("reads the direct snapshot FK and uses its fixed pool without legacy duplication",async()=>{
    const result=await komisiPeriode(client(),"2026-10");
    expect(result.hasil.map(row=>[row.employeeId,row.komisi]).sort()).toEqual([["doctor",1250],["nurse",1250]]);
    expect(result.baris[0]).toMatchObject({omzet:50000,fixedCommission:true});
  });
  it("keeps the earned pool in its original month when reissue has a later paid_at",async()=>{
    const original=await komisiPeriode(client(true),"2026-10");
    const later=await komisiPeriode(client(true),"2026-12");
    expect(original.hasil.reduce((sum,row)=>sum+row.komisi,0)).toBe(2500);
    expect(later.hasil.reduce((sum,row)=>sum+row.komisi,0)).toBe(0);
  });
});
