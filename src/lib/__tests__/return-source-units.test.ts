import { expect, it } from 'vitest';
import { returnSourceRows } from '../return-source-units';
it('keeps differing prices and ceilings on exact source lines', () => {
 const rows=returnSourceRows([{id:'box',item_id:'sku',nama:'SKU',qty:1,faktor:12,harga:120},{id:'pcs',item_id:'sku',nama:'SKU',qty:3,faktor:1,harga:20}], [{source_line_id:'box',item_id:'sku',qty:6}]);
 expect(rows.map(r=>[r.source_line_id,r.sisa,r.harga])).toEqual([['box',6,10],['pcs',3,20]]);
});
it('fails closed on ambiguous legacy return attribution instead of inventing weighted prices',()=>{
 expect(()=>returnSourceRows([{id:'a',item_id:'sku',nama:'SKU',qty:1,faktor:12,harga:120},{id:'b',item_id:'sku',nama:'SKU',qty:3,faktor:1,harga:60}],[{item_id:'sku',qty:1}])).toThrow(/rekonsiliasi/);
});
it('maps legacy returns to a unique source without backfilling history',()=>{
 expect(returnSourceRows([{id:'a',item_id:'sku',nama:'SKU',qty:2,faktor:12,harga:120}],[{item_id:'sku',qty:4}])[0].sisa).toBe(20);
});
it('rejects incomplete source projections so missing item references cannot silently hide the source document',()=>{
 expect(()=>returnSourceRows([{id:'a',nama:'SKU',qty:2,faktor:12,harga:120} as never],[])).toThrow(/rincian sumber/);
});
