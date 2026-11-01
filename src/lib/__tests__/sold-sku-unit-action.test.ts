import {beforeEach,expect,it,vi} from 'vitest';
const s=vi.hoisted(()=>({blocked:true,soldUnits:false,writes:[] as string[],calls:[] as {name:string;params:unknown}[],
 master:['pcs'] as string[],itemUnit:'pcs',itemUnits:[] as {unit:string;factor:number;sell_price:number;buy_price:number}[],cleared:0}));
vi.mock('next/navigation',()=>({redirect:(url:string)=>{throw Error(decodeURIComponent(url))}}));
vi.mock('@/lib/cache-memori',()=>({bersihkanCacheSebentar:()=>{s.cleared++}}));
vi.mock('@/lib/master-guard',()=>({assertMasterAdmin:async()=>({rpc:async(name:string,params:unknown)=>{s.calls.push({name,params});const p=params as {p_units?:unknown[]};
 // soldUnits: the database refuses to delete sold leftover conversions (guard_sold_item_units).
 const refused=name==='replace_item_unit_configuration'&&(s.blocked||(s.soldUnits&&s.itemUnits.length>0&&(p.p_units??[]).length===0));
 return {error:refused?{message:s.blocked?'Konversi SKU sudah memiliki penjualan; buat SKU baru':'SKU sudah memiliki penjualan. Konversi satuan historis tidak boleh diubah atau dihapus'}:null}},from(table:string){
 const rows=()=>table==='units'?s.master.map(nama=>({nama})):table==='item_units'?s.itemUnits:[];
 const q={select:()=>q,eq:()=>q,ilike:()=>q,in:()=>q,insert:()=>{s.writes.push(table);return q},update:()=>{s.writes.push(table);return q},delete:()=>{s.writes.push(table);return q},
  maybeSingle:async()=>({data:table==='items'?{id:'item',unit:s.itemUnit}:null,error:null}),
  then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:rows(),error:null}).then(resolve)};return q}})}));
import {simpanBarang} from '@/app/(app)/pos/sku/actions';
const form=(extra:Record<string,string>={})=>{const f=new FormData();for(const [k,v] of Object.entries({id:'item',name:'Fictional SKU',code:'I07',category_id:'cat',item_type:'Persediaan',unit:'pcs',sell_price:'150000',units:JSON.stringify([{unit:'box',factor:28,sell_price:28000,buy_price:14000}]),...extra}))f.set(k,v);return f};
const unitCall=()=>s.calls.find(call=>call.name==='replace_item_unit_configuration')?.params as {p_base_unit:string;p_units:unknown[]};
beforeEach(()=>{s.blocked=true;s.soldUnits=false;s.writes=[];s.calls=[];s.master=['pcs'];s.itemUnit='pcs';s.itemUnits=[];s.cleared=0});
it('rejects a sold conversion before other master changes and explains new SKU',async()=>{await expect(simpanBarang(form())).rejects.toThrow('buat SKU baru');expect(s.writes).toEqual([])});
it('routes successful edits through the atomic base/unit configuration without destructive replacement',async()=>{s.blocked=false;await expect(simpanBarang(form())).rejects.toThrow('success=1');expect(s.calls).toContainEqual({name:'replace_item_unit_configuration',params:{p_item_id:'item',p_base_unit:'pcs',p_units:[{unit:'box',factor:28,sell_price:28000,buy_price:14000}]}});expect(s.writes).not.toContain('item_units')});

// Clinic 1 Nov: price edits in Barang & Jasa "did not take effect". Imported SKUs keep the file's
// spelling ("PCS") while the unit list is lower case ("pcs"); the save used to rename the base
// unit, which the sold-SKU guard rejects, so the whole save — price included — failed.
it('keeps the stored base-unit spelling when only letter case differs from the unit list',async()=>{
 s.blocked=false;s.itemUnit='PCS';
 await expect(simpanBarang(form({unit:'PCS'}))).rejects.toThrow('success=1');
 expect(unitCall().p_base_unit).toBe('PCS');
 expect(s.writes).toContain('items');
 expect(s.cleared).toBe(1);
});
it('prefers the exact spelling when the unit list holds the same unit twice in different case',async()=>{
 s.blocked=false;s.master=['pcs','PCS'];s.itemUnit='kotak';
 await expect(simpanBarang(form({unit:'PCS'}))).rejects.toThrow('success=1');
 expect(unitCall().p_base_unit).toBe('PCS');
});
it('still sends a real base-unit change to the database guard',async()=>{
 s.blocked=false;s.master=['box'];s.itemUnit='pcs';
 await expect(simpanBarang(form({unit:'box',units:'[]'}))).rejects.toThrow('success=1');
 expect(unitCall().p_base_unit).toBe('box');
});
it('rejects a new item whose unit is not in the active unit list',async()=>{
 s.master=[];
 await expect(simpanBarang(form({id:'',unit:'kali'}))).rejects.toThrow('Satuan dasar belum terdaftar atau sudah nonaktif');
 expect(s.calls).toEqual([]);
});
const jasa={item_type:'Jasa',tindakan_kategori:'Konsultasi',unit:'PCS',units:'[]'};
const unitCalls=()=>s.calls.filter(call=>call.name==='replace_item_unit_configuration').map(call=>call.params as {p_units:unknown[]});
it('keeps leftover unit rows of a sold service when the database refuses to delete them, so the price still saves',async()=>{
 s.blocked=false;s.soldUnits=true;s.itemUnit='PCS';s.itemUnits=[{unit:'PCS',factor:1,sell_price:1,buy_price:0},{unit:'paket',factor:3,sell_price:400000,buy_price:0}];
 await expect(simpanBarang(form(jasa))).rejects.toThrow('success=1');
 expect(unitCalls().map(call=>call.p_units)).toEqual([[],[{unit:'paket',factor:3,sell_price:400000,buy_price:0}]]);
 expect(s.writes).toContain('items');
});
it('still cleans leftover packaging off an unsold service',async()=>{
 s.blocked=false;s.itemUnit='PCS';s.itemUnits=[{unit:'box',factor:12,sell_price:120000,buy_price:0}];
 await expect(simpanBarang(form(jasa))).rejects.toThrow('success=1');
 expect(unitCalls().map(call=>call.p_units)).toEqual([[]]);
});
it('does not retry a refused unit change for stock items',async()=>{
 await expect(simpanBarang(form())).rejects.toThrow('buat SKU baru');
 expect(unitCalls()).toHaveLength(1);
});
