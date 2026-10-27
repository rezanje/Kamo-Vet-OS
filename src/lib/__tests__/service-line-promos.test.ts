import { expect,it } from "vitest";
import { aggregateServiceLines,serviceLinePromos } from "../service-line-promos";
import type { PromoHitung } from "../promo-hitung";
const promo:PromoHitung={id:"p",name:"Existing",itemIds:["s"],minQty:2,maxQty:2,kelipatan:false,autoApply:true,discountType:"percent",discountValue:20};
const rows=[{item_id:"s",qty:1,harga:99,item_type:"Jasa",row_key:"a",satuan:"x"},{item_id:"s",qty:1,harga:99,item_type:"Jasa",row_key:"b",satuan:"x"}];
it("preserves merged service quantity eligibility and exactly allocates its integral discount",()=>{
 const result=serviceLinePromos([promo],rows);expect(result).toHaveLength(2);expect(result.map(row=>row.lineIndex)).toEqual([0,1]);expect(result.reduce((sum,row)=>sum+row.potongan,0)).toBe(40);
 expect(serviceLinePromos([{...promo,minQty:1,maxQty:1}],rows).reduce((sum,row)=>sum+row.potongan,0)).toBe(20);
 expect(rows.map(row=>row.qty)).toEqual([1,1]);
});
it("keeps service quantity aggregation for category-rounding but preserves physical row behavior",()=>{
 expect(aggregateServiceLines(rows).map(row=>row.qty)).toEqual([2]);
 expect(aggregateServiceLines(rows.map(row=>({...row,item_type:"Persediaan"})))).toHaveLength(2);
 expect(aggregateServiceLines([rows[0],{...rows[1],satuan:"box"}])).toHaveLength(2);
 expect(aggregateServiceLines([rows[0],{...rows[1],harga:100}])).toHaveLength(2);
});
it("uses full-cart min subtotal, stable original indexes and never applies one SKU discount twice",()=>{
 const result=serviceLinePromos([{...promo,minSubtotal:300}],[...rows,{item_id:"p",qty:1,harga:102,item_type:"Persediaan",row_key:"p"}]);
 expect(result.reduce((sum,row)=>sum+row.potongan,0)).toBe(40);expect(result.map(row=>row.lineIndex)).toEqual([0,1]);
 expect(serviceLinePromos([{...promo,minSubtotal:301}],rows)).toEqual([]);
});
it("allocates one package-total amount across repeated service rows without doubling it",()=>{
 const packagePromo:PromoHitung={...promo,minQty:5,maxQty:5,discountType:"nominal",discountValue:10000,discountMode:"package_total"};
 const repeated=[{...rows[0],qty:2,harga:10000},{...rows[1],qty:3,harga:10000}];
 const result=serviceLinePromos([packagePromo],repeated);
 expect(result.map(row=>row.potongan)).toEqual([4000,6000]);
 expect(result.reduce((sum,row)=>sum+row.potongan,0)).toBe(10000);
 expect(repeated.map(row=>row.qty)).toEqual([2,3]);
});
