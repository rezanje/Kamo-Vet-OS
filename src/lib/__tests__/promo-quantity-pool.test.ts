import {expect,it} from 'vitest';
import {hitungPromoKeranjang,totalPotonganPromo,potonganBaris,type PromoHitung} from '../promo-hitung';

import {serviceLinePromos} from '../service-line-promos';
import {allocateQuantityPool,parseQuantityPoolRule} from '../promo-quantity-pool';
const rule = {version:1 as const,unit:'PCS' as const,normal_price:20000,tiers:[{qty:6,total:110000},{qty:2,total:38000}]};
const pool = (patch:Partial<PromoHitung>={}):PromoHitung => ({id:'bolt',name:'Bolt',itemIds:['a','b'],minQty:null,maxQty:null,kelipatan:true,autoApply:true,discountType:null,discountValue:null,discountMode:'quantity_pool',quantityPool:rule,...patch});
const row = (item_id:string,qty=1) => ({item_id,qty,harga:20000,satuan:'PCS',faktor:1,officialPrice:20000});
it('preserves duplicate product source rows and original IDs through synthetic mapping and excludes manual rows before pooling',()=>{
 const cart=[{...row('a'),row_key:'z',item_type:'Persediaan'},{...row('a'),row_key:'a',item_type:'Persediaan'},
 {...row('b'),row_key:'m',item_type:'Persediaan'},
 {...row('a',3),item_discount_type:'nominal',item_discount_value:1},
 {...row('a'),satuan:'SAK',faktor:25},{...row('outside',6)}];
 const before=structuredClone(cart);
 const result=serviceLinePromos([pool()],cart);
 expect(result.map(r=>[r.lineIndex,r.item_id,r.potongan])).toEqual([[0,'a',667],[1,'a',667],[2,'b',666]]);
 expect(cart).toEqual(before);
 expect(serviceLinePromos([pool({itemIds:['absent']})],cart)).toEqual([]);
});
it.each([[1,20000],[2,38000],[3,58000],[4,76000],[5,96000],[6,110000],[7,130000],[8,148000],[10,186000],[12,220000],[13,240000],[14,258000],[18,330000],[20,368000],[24,440000],[25,460000],[100,1836000]])('acceptance qty%s has exact net%s for each brand', (qty,net)=>{
 for(const id of ['bolt','cat']) {
  const p=pool({id,itemIds:[`${id}-a`,`${id}-b`]});
  expect(qty*20000-totalPotonganPromo(serviceLinePromos([p],[row(`${id}-a`,qty)]))).toBe(net);
 }
});
it('refuses a pool in the legacy single-line calculator even when nominal columns remain filled',()=>{
 expect(()=>potonganBaris(row('a',2),pool({discountType:'nominal',discountValue:2000}))).toThrow(/quantity pool/i);
});
it('prices two mixed variants from the same brand at38000 without mutating original rows',()=>{
 const cart=[row('a'),row('b')],before=structuredClone(cart);
 expect(40000-totalPotonganPromo(hitungPromoKeranjang([pool()],cart))).toBe(38000);
 expect(cart).toEqual(before);
});
it('uses repeated six then two tiers, normal odd remainder and separate brand pools',()=>{
 const net=(qty:number)=>qty*20000-totalPotonganPromo(hitungPromoKeranjang([pool()],[row('a',qty-1),row('b')]));
 expect([2,3,6,7,8,12,14,15].map(net)).toEqual([38000,58000,110000,130000,148000,220000,258000,278000]);
 const brands=[pool(),pool({id:'cat',itemIds:['c','d']})];
 expect(hitungPromoKeranjang(brands,[row('a'),row('c')])).toEqual([]);
 expect(totalPotonganPromo(hitungPromoKeranjang(brands,[row('a',4),row('b',2),row('c'),row('d')]))).toBe(12000);
});
it.each([
 {qty:1.5},{qty:0},{qty:-1},{qty:NaN},{qty:Infinity},
 {satuan:'SAK',faktor:25},{satuan:'pcs'},{satuan:undefined},
 {faktor:25},{faktor:undefined},{harga:19999},{officialPrice:19999},{officialPrice:undefined},
 {manualOverride:true},{item_discount_type:'nominal',item_discount_value:1000},
])('excludes non-official or manual PCS rows without counting them toward a pool: %j',patch=>{
 expect(hitungPromoKeranjang([pool()],[row('a'),{...row('b'),...patch}])).toEqual([]);
});
it('conserves rupiah with largest remainders and immutable input position tie ordering, not ID sorting',()=>{
 expect(allocateQuantityPool(rule,[{id:'z',qty:1},{id:'a',qty:1},{id:'m',qty:1}])).toEqual({z:667,a:667,m:666});
 expect(allocateQuantityPool(rule,[{id:'z',qty:1},{id:'a',qty:2}])).toEqual({z:667,a:1333});
 expect(allocateQuantityPool(rule,[{id:'a',qty:4},{id:'b',qty:2}])).toEqual({a:6667,b:3333});
 const actual=allocateQuantityPool(rule,Array.from({length:15},(_,index)=>({id:`row:${index}`,qty:1})));
 expect(Object.values(actual).reduce((a,b)=>a+b,0)).toBe(22000);
 expect(Object.values(actual).slice(0,10)).toEqual(Array(10).fill(1467));
 expect(Object.values(actual).slice(10)).toEqual(Array(5).fill(1466));
});
it('chooses an entire pool or the existing stronger promo, never a partial pooled discount',()=>{
 const legacy:PromoHitung={...pool(),id:'legacy',itemIds:['a'],discountMode:'per_unit',quantityPool:undefined,discountType:'nominal',discountValue:3000,minQty:1};
 const cart=[row('a'),row('b')];
 expect(hitungPromoKeranjang([legacy,pool()],cart)).toMatchObject([{item_id:'a',potongan:3000,promoId:'legacy'}]);
 expect(hitungPromoKeranjang([{...legacy,discountValue:2000},pool()],cart)).toMatchObject([{item_id:'a',potongan:2000,promoId:'legacy'}]);
 expect(hitungPromoKeranjang([{...legacy,discountValue:500},pool()],cart).map(r=>[r.promoId,r.potongan])).toEqual([['bolt',1000],['bolt',1000]]);
});
it('fails closed in the pure calculator for missing configuration and invalid allocation identities or arithmetic',()=>{
 expect(()=>hitungPromoKeranjang([pool({quantityPool:undefined})],[row('a'),row('b')])).toThrow(/quantity pool/i);
 expect(()=>hitungPromoKeranjang([pool({itemIds:[]})],[row('a'),row('b')])).toThrow(/quantity pool/i);
 for(const lines of [[{id:'x',qty:1},{id:'x',qty:1}],[{id:'x',qty:1.5}],[{id:'x',qty:-1}],[{id:'x',qty:Number.MAX_SAFE_INTEGER}]]) {
  expect(()=>allocateQuantityPool(rule,lines)).toThrow(/quantity pool/i);
 }
 expect(allocateQuantityPool(rule,[])).toEqual({});
});
it('accepts only the reviewed v1 20000/6+2 campaign shape, matching the independent database constraint',()=>{
 for(const invalid of [{...rule,normal_price:30000},{...rule,tiers:[{qty:2,total:38000}]},
 {...rule,tiers:[{qty:6,total:100000},{qty:2,total:38000}]},{...rule,tiers:[...rule.tiers].reverse()},
 {...rule,future_mode:true},{...rule,tiers:[{qty:6,total:110000,extra:true},{qty:2,total:38000}]}]) {
  expect(parseQuantityPoolRule(invalid)).toBeNull();
 }
});
it('parses strict numeric versioned rules without mutating or sharing their nested tiers',()=>{
 const parsed=parseQuantityPoolRule(rule);expect(parsed).toEqual(rule);
 parsed!.tiers[0].total=1;expect(rule.tiers[0].total).toBe(110000);
 for(const invalid of [null,[],{}, {...rule,version:2},{...rule,unit:'SAK'},{...rule,normal_price:'20000'},
 {...rule,tiers:[]},{...rule,tiers:[{qty:2,total:40000}]},{...rule,tiers:[{qty:2,total:0}]},
 {...rule,tiers:[{qty:2,total:38000},{qty:2,total:38000}]},{...rule,tiers:[{qty:'2',total:38000}]}]) {
  expect(parseQuantityPoolRule(invalid)).toBeNull();
 }
});
