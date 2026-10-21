import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(()=>({tables:{} as Record<string,Record<string,unknown>[]>,failedPage:-1,truncatePage:-1}));
vi.mock("next/navigation",()=>({redirect:(href:string)=>{throw new Error(`REDIRECT:${href}`);}}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({
  auth:{getUser:async()=>({data:{user:{id:"owner"}}})},
  from(table:string){
    let counted=false,from=0,to=999,limit=Infinity;
    const filters:((row:Record<string,unknown>)=>boolean)[]=[];
    const sorts:string[]=[];
    const result=()=>{
      if(table==="items" && from===fixture.failedPage) return {data:null,count:null,error:{message:"Catalog temporarily unavailable"}};
      const rows=(fixture.tables[table] ?? []).filter(row=>filters.every(filter=>filter(row))).sort((a,b)=>{
        for(const column of sorts){if(a[column]===b[column])continue;return a[column]!<b[column]! ? -1 : 1;}return 0;
      });
      const page=rows.slice(from,Math.min(to+1,from+1000,limit));
      if(table==="items" && from===fixture.truncatePage)page.pop();
      return {data:page,count:counted ? rows.length : null,error:null};
    };
    const q={select(_columns:string,options?:{count:string}){counted=options?.count==="exact";return q;},
      eq(column:string,value:unknown){filters.push(row=>row[column]===value);return q;},
      neq(column:string,value:unknown){filters.push(row=>row[column]!==value);return q;},
      in(column:string,values:string[]){filters.push(row=>values.includes(String(row[column])));return q;},
      order(column:string){sorts.push(column);return q;},limit(n:number){limit=n;return q;},
      range(a:number,b:number){from=a;to=b;return q;},
      maybeSingle:async()=>({...result(),data:result().data?.[0] ?? null}),
      then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve),
    };return q;
  },
})}));
import { siapkanFormBarang } from "../../app/(app)/pos/sku/data";

beforeEach(()=>{
 fixture.failedPage=-1;fixture.truncatePage=-1;
 const items=Array.from({length:6001},(_,i)=>({id:`item-${String(i).padStart(4,"0")}`,code:`SKU-${i}`,name:i===6000?"Zebra late component":`Component ${String(i).padStart(4,"0")}`,
  unit:"pcs",sell_price:100,buy_price:50,item_type:i===6000?"Jasa":i===5999?"Non-Persediaan":"Persediaan",is_active:true}));
 fixture.tables={profiles:[{id:"owner",role:"OWNER",is_active:true}],items:[...items,
  {...items[0],id:"inactive",name:"Inactive Z item",is_active:false},
  {...items[0],id:"nested-group",name:"Nested Z group",item_type:"Grup"}],
  item_units:[{item_id:"item-5998",unit:"box",factor:10,sell_price:900,buy_price:400}],
 };
});

describe("Group component catalog on new and edit item forms",()=>{
 it("loads eligible components past the API cap and former 5000 limit, retaining filters and alphabetical order",async()=>{
  const form=await siapkanFormBarang();
  expect(form.kandidatGrup).toHaveLength(6001);
  expect(form.kandidatGrup.at(-1)).toMatchObject({id:"item-6000",name:"Zebra late component",item_type:"Jasa"});
  expect(form.kandidatGrup.find(row=>row.id==="item-5999")?.item_type).toBe("Non-Persediaan");
  expect(form.kandidatGrup.some(row=>["inactive","nested-group"].includes(row.id))).toBe(false);
  expect(form.kandidatGrup.map(row=>row.name)).toEqual(form.kandidatGrup.map(row=>row.name).sort());
 });
 it("loads substitute stock items and extra units for late components",async()=>{
  const form=await siapkanFormBarang();
  expect(form.barangLain).toHaveLength(5999);
  expect(form.barangLain.at(-1)?.id).toBe("item-5998");
  expect(form.kandidatGrup.find(row=>row.id==="item-5998")?.units).toEqual([{unit:"pcs",factor:1},{unit:"box",factor:10}]);
 });
 it("rejects a failed later catalog page instead of presenting an incomplete list",async()=>{
  fixture.failedPage=500;
  await expect(siapkanFormBarang()).rejects.toThrow(/unavailable/i);
 });
 it("rejects a truncated later catalog page instead of silently stopping",async()=>{
  fixture.truncatePage=500;
  await expect(siapkanFormBarang()).rejects.toThrow(/terpotong/);
 });
});
