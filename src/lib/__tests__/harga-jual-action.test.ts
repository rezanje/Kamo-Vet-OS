import {beforeEach,expect,it,vi} from 'vitest';
// Harga Jual: only rows the user actually changed are written, and a vial's new base price is
// carried to its "Vaksinasi …" service. 1 Nov 15.58: saving an old tab reverted 15 fresh prices.
const s=vi.hoisted(()=>({writes:[] as {table:string;patch:unknown;filters:Record<string,unknown>}[],
 items:[] as {id:string;unit:string;code:string|null;item_type:string}[]}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error(decodeURIComponent(url))}}));
vi.mock('@/lib/cache-memori',()=>({bersihkanCacheSebentar:()=>{}}));
vi.mock('@/lib/master-guard',()=>({assertMasterAdmin:async()=>({from(table:string){
 let write:{table:string;patch:unknown;filters:Record<string,unknown>}|null=null;
 const q={select:()=>q,in:()=>q,neq:()=>q,
  eq:(column:string,value:unknown)=>{if(write)write.filters[column]=value;return q},
  update:(patch:unknown)=>{write={table,patch,filters:{}};s.writes.push(write);return q},
  upsert:(patch:unknown)=>{s.writes.push({table,patch,filters:{}});return q},
  delete:()=>{write={table,patch:'delete',filters:{}};s.writes.push(write);return q},
  then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='items'&&!write?s.items:[],error:null}).then(resolve)};
 return q}})}));
import {simpanHargaJual} from '@/app/(app)/pos/harga/actions';
const form=(fields:Record<string,string>)=>{const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,v);return f};
beforeEach(()=>{s.writes=[];s.items=[
 {id:'vial',unit:'VIAL',code:'OBT-431',item_type:'Persediaan'},
 {id:'usg',unit:'PCS',code:'100028',item_type:'Jasa'},
]});
it('writes only the row that changed, never the untouched rows of an old tab',async()=>{
 await expect(simpanHargaJual(form({branch_id:'',
  'o|usg|PCS':'200000','h|usg|PCS':'150000',
  'o|vial|VIAL':'235000','h|vial|VIAL':'235000',
 }))).rejects.toThrow('success=1');
 expect(s.writes).toEqual([{table:'items',patch:{sell_price:150000},filters:{id:'usg'}}]);
});
it('carries a changed vial price to its vaccination service',async()=>{
 await expect(simpanHargaJual(form({branch_id:'','o|vial|VIAL':'235000','h|vial|VIAL':'250000'}))).rejects.toThrow('success=1');
 expect(s.writes).toEqual([
  {table:'items',patch:{sell_price:250000},filters:{id:'vial'}},
  {table:'items',patch:{sell_price:250000},filters:{code:'JV-OBT-431',item_type:'Jasa'}},
 ]);
});
it('treats rows without an original value (form opened before this release) as changed',async()=>{
 await expect(simpanHargaJual(form({branch_id:'','h|usg|PCS':'150000'}))).rejects.toThrow('success=1');
 expect(s.writes).toEqual([{table:'items',patch:{sell_price:150000},filters:{id:'usg'}}]);
});
it('branch mode: an untouched empty field does not delete anything, a cleared override does',async()=>{
 await expect(simpanHargaJual(form({branch_id:'b1',
  'o|usg|PCS':'','h|usg|PCS':'',
  'o|vial|VIAL':'240000','h|vial|VIAL':'',
 }))).rejects.toThrow('success=1');
 expect(s.writes).toEqual([{table:'item_branch_prices',patch:'delete',filters:{item_id:'vial',branch_id:'b1',unit:'VIAL'}}]);
});
