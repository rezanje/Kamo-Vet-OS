import {describe,it,expect} from 'vitest';
import {loadPromoAktif,hitungPromoKeranjang} from '../promo-hitung';

const promo=(id:string,patch:Record<string,unknown>={})=>({id,name:id,rule:{},branch_ids:null,valid_from:null,valid_until:null,is_active:true,auto_apply:true,min_qty:null,max_qty:null,kelipatan:false,discount_type:'nominal',discount_value:2000,...patch});
type Row=Record<string,unknown>;
function database(promos:Row[],targets:Row[],failure?:{table:string;from?:number;mode?:'error'|'count'|'truncated'|'duplicate'|'throw'}){
 const calls:{table:string;ids?:string[];from:number;to:number;counted:boolean;orders:string[]}[]=[];
 return {calls,from(table:string){let ids:string[]|undefined;const eqs:Record<string,unknown>={};let counted=false;const orders:string[]=[];
 const result=(from:number,to:number)=>{calls.push({table,ids,from,to,counted,orders:[...orders]});const rows=(table==='promos'?promos:targets).filter(r=>Object.entries(eqs).every(([k,v])=>r[k]===v)&&(!ids||ids.includes(String(r.promo_id))));
 const matches=failure?.table===table&&(failure.from??0)===from;
 if(matches&&failure.mode==='throw')throw Error('private backend details');
 if(matches&&(failure.mode??'error')==='error')return {data:null,error:{message:'private backend details'},count:null};
 let page=rows.slice(from,to+1);
 if(matches&&failure.mode==='truncated')page=page.slice(0,-1);
 if(matches&&failure.mode==='duplicate'&&page.length>1)page=[page[0],page[0],...page.slice(2)];
 return {data:page,error:null,count:matches&&failure.mode==='count'?null:rows.length};};
 const q={select(_columns:string,options?:{count?:string}){counted=options?.count==='exact';return q;},eq(k:string,v:unknown){eqs[k]=v;return q;},in(_k:string,v:string[]){ids=v;return q;},order(k:string){orders.push(k);return q;},range(a:number,b:number){return Promise.resolve(result(a,b));},then(resolve:(x:ReturnType<typeof result>)=>unknown){return Promise.resolve(result(0,999)).then(resolve);}};return q;}};
}
describe('active promo source completeness',()=>{
 it('reads late active promos beyond the default cap and preserves branch/date/status filters',async()=>{const rows=Array.from({length:1205},(_,i)=>promo(`p${String(i).padStart(4,'0')}`));rows.push(promo('foreign',{branch_ids:['other']}),promo('future',{valid_from:'2999-01-01'}),promo('expired',{valid_until:'2000-01-01'}),promo('inactive',{is_active:false}),promo('manual',{auto_apply:false}));const db=database(rows,[]);const actual=await loadPromoAktif(db,'own');expect(actual).toHaveLength(1205);expect(actual.at(-1)?.id).toBe('p1204');expect(db.calls.filter(c=>c.table==='promos').every(c=>c.counted&&c.orders.includes('id'))).toBe(true);expect(db.calls.filter(c=>c.table==='promo_items').every(c=>(c.ids?.length??0)<=200)).toBe(true);});
 it('keeps every target SKU after1000 and never widens a targeted promo',async()=>{const targets=Array.from({length:1205},(_,i)=>({promo_id:'p',item_id:`sku${String(i).padStart(4,'0')}`}));const db=database([promo('p')],targets);const actual=await loadPromoAktif(db,'own');expect(actual[0].itemIds).toHaveLength(1205);expect(hitungPromoKeranjang(actual,[{item_id:'sku1204',qty:1,harga:10000},{item_id:'outside',qty:1,harga:10000}]).map(r=>r.item_id)).toEqual(['sku1204']);expect(db.calls.filter(c=>c.table==='promo_items').every(c=>c.counted&&c.orders.join(',')==='promo_id,item_id')).toBe(true);});
 it.each(['error','count','truncated','duplicate','throw'] as const)('rejects %s while loading targets instead of treating them as all products',async mode=>{const db=database([promo('p')],[{promo_id:'p',item_id:'a'},{promo_id:'p',item_id:'b'}],{table:'promo_items',mode});await expect(loadPromoAktif(db,'own')).rejects.toThrow(/Promo|promo/);});
 it('rejects a later page error without returning earlier partial targets',async()=>{const db=database([promo('p')],Array.from({length:600},(_,i)=>({promo_id:'p',item_id:String(i)})),{table:'promo_items',from:500});await expect(loadPromoAktif(db,'own')).rejects.toThrow(/Promo|promo/);});
 it('rejects unknown active-list completeness rather than pricing without promos',async()=>{const db=database([promo('p')],[],{table:'promos',mode:'count'});await expect(loadPromoAktif(db,'own')).rejects.toThrow(/Promo|promo/);});
 it('verified empty target list still means all products; no active promo avoids target reads',async()=>{const db=database([promo('p')],[]);expect((await loadPromoAktif(db,'own'))[0].itemIds).toEqual([]);const empty=database([],[]);expect(await loadPromoAktif(empty,'own')).toEqual([]);expect(empty.calls.some(c=>c.table==='promo_items')).toBe(false);});
});

it('loads exact quantity-pool rules for mixed variants and refuses partial rule or empty scope',async()=>{
 const quantity_pool={version:1,unit:'PCS',normal_price:20000,tiers:[{qty:6,total:110000},{qty:2,total:38000}]};
 const p=promo('pool',{rule:{discount_mode:'quantity_pool',quantity_pool},discount_type:null,discount_value:null});
 const targets=[{promo_id:'pool',item_id:'a'},{promo_id:'pool',item_id:'b'}];
 const rules=await loadPromoAktif(database([p],targets),'own');
 expect(rules[0]).toMatchObject({discountMode:'quantity_pool',quantityPool:quantity_pool});
 const cart=['a','b'].map(item_id=>({item_id,qty:1,harga:20000,satuan:'PCS',faktor:1,officialPrice:20000}));
 expect(hitungPromoKeranjang(rules,cart).reduce((sum,r)=>sum+r.potongan,0)).toBe(2000);
 await expect(loadPromoAktif(database([p],[]),'own')).rejects.toThrow(/pool/i);
 for(const rule of [{discount_mode:'quantity_pool'},{discount_mode:'quantity_pool',quantity_pool:{...quantity_pool,tiers:[]}},{quantity_pool}]) {
  await expect(loadPromoAktif(database([{...p,rule}],targets),'own')).rejects.toThrow(/pool/i);
 }
});
// Existing nominal contract: amount is per eligible unit, not a campaign total.
it('preserves the requested4/5/6 quantity boundary without inventing package totals',async()=>{
 const db=database([promo('p',{min_qty:5,max_qty:5})],[]);const rules=await loadPromoAktif(db,'own');
 expect([4,5,6].map(qty=>hitungPromoKeranjang(rules,[{item_id:'a',qty,harga:10000}]).reduce((sum,r)=>sum+r.potongan,0))).toEqual([0,10000,10000]);
 const repeating=rules.map(p=>({...p,maxQty:null,kelipatan:true}));
 expect([4,5,6,10].map(qty=>hitungPromoKeranjang(repeating,[{item_id:'a',qty,harga:10000}]).reduce((sum,r)=>sum+r.potongan,0))).toEqual([0,10000,10000,20000]);
 expect(hitungPromoKeranjang([{...rules[0],minQty:null,maxQty:null}],[{item_id:'a',qty:1,harga:10000}])[0].potongan).toBe(2000);
});
it('loads explicit package-total mode and fails closed on malformed active configuration',async()=>{
 const row=promo('p',{rule:{discount_mode:'package_total'},min_qty:5,max_qty:5});
 const targets=[{promo_id:'p',item_id:'a'}];
 const rules=await loadPromoAktif(database([row],targets),'own');
 expect([4,5,6,10].map(qty=>hitungPromoKeranjang(rules,[{item_id:'a',qty,harga:10000}]).reduce((sum,r)=>sum+r.potongan,0))).toEqual([0,2000,2000,2000]);
 await expect(loadPromoAktif(database([row],[]),'own')).rejects.toThrow('satu barang');
 await expect(loadPromoAktif(database([promo('p',{rule:{discount_mode:'unknown'}})],[]),'own')).rejects.toThrow('Cara hitung');
});
