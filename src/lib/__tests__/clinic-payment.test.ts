import { describe, expect, it } from "vitest";
import { loadClinicPaymentMaster, resolveClinicSalesperson } from "../clinic-payment";

type Row = Record<string, unknown>;
function database(tables: Record<string, Row[]>, failed = "") {
  return { from(table: string) {
    const filters: ((r: Row) => boolean)[] = []; let start=0; let end=999; let count=false;
    const q = {
      select(_fields: string, opts?: { count: string }) { count=opts?.count==="exact"; return q; },
      eq(k: string,v: unknown) { filters.push(r=>r[k]===v);return q; },
      in(k: string,ids: string[]) { filters.push(r=>ids.includes(String(r[k])));return q; },
      order() { return q; }, limit(n: number) { end=n-1;return q; },
      range(a: number,b: number) { start=a;end=b;return q; },
      maybeSingle: async()=>({data:(tables[table]??[]).find(r=>filters.every(f=>f(r)))??null,error:null}),
      then(resolve: (v: unknown)=>unknown) {
        const rows=(tables[table]??[]).filter(r=>filters.every(f=>f(r)));
        return Promise.resolve({ data:failed===table?null:rows.slice(start,end+1),count:count?rows.length:null,error:failed===table?{message:"secret"}:null }).then(resolve);
      },
    };return q;
  } };
}
const items = Array.from({length:1010},(_,i)=>({id:`item-${i}`,code:`SKU${i}`,name:`Medicine ${i}`,unit:"PCS",sell_price:1000,item_type:"Persediaan",is_active:true,is_compound_material:false}));
describe("clinic payment catalogue",()=>{
  it("loads complete masters and branch-priced units beyond 1000",async()=>{
    const db=database({items:[...items,{id:"service",name:"Consult",unit:"kali",sell_price:5000,item_type:"Jasa",is_active:true}],
      item_units:[{id:"unit",item_id:"item-1009",unit:"box",factor:10,sell_price:8000,buy_price:5000}],
      item_branch_prices:[{id:"price",item_id:"item-1009",branch_id:"branch",unit:"box",sell_price:9000}],
      warehouses:[]});
    const result=await loadClinicPaymentMaster(db,"branch");
    expect(result.obat).toHaveLength(1010);expect(result.jasa).toHaveLength(1);
    expect(result.obat.at(-1)).toMatchObject({id:"item-1009",units:expect.arrayContaining([expect.objectContaining({unit:"box",factor:10,sell_price:9000})])});
  });
  it.each(["items","item_units","item_branch_prices"])("fails visibly on unreadable %s",async(table)=>{
    await expect(loadClinicPaymentMaster(database({items:[items[0]]},table),"branch")).rejects.toThrow(/belum.*dimuat/);
  });
});
const employees=[{id:"doctor",branch_id:"branch",status:"Aktif"},{id:"groomer",branch_id:"branch",status:"Aktif"},{id:"foreign",branch_id:"other",status:"Aktif"},{id:"inactive",branch_id:"branch",status:"Nonaktif"}];
describe("clinic payment salesperson selection",()=>{
  const db=database({employees,employee_branch_assignments:[{employee_id:"assigned",branch_id:"branch"}]});
  it("uses an eligible provider when there is no doctor",async()=>{
    expect(await resolveClinicSalesperson(db,"branch",null,"groomer")).toBe("groomer");
  });
  it("allows an explicit eligible staff member",async()=>{
    expect(await resolveClinicSalesperson(db,"branch","doctor",null,"groomer")).toBe("groomer");
  });
  it.each(["foreign","inactive","unknown"])("rejects spoofed or unavailable %s",async(id)=>{
    await expect(resolveClinicSalesperson(db,"branch","doctor",null,id)).rejects.toThrow("Penjual");
  });
  it("lets an explicit blank remain unassigned",async()=>{
    expect(await resolveClinicSalesperson(db,"branch","doctor",null,"")).toBeNull();
  });
  it("does not inherit an ineligible doctor",async()=>{
    expect(await resolveClinicSalesperson(db,"branch","foreign","groomer")).toBe("groomer");
  });
});
