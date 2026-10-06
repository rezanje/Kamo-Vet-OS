import { describe, expect, it } from "vitest";
import { masterCompoundCartRow } from "./master-compound-cart";
const sku={id:"sku",name:"Obat Racik Master",unit:"pcs",sell_price:1200,stok:7};
const draft={saleItemId:"sku",formulaId:"",dosageForm:"puyer",instruction:"2x sehari",ingredients:[{item_id:"material",nama:"Bahan",qty:0.5,satuan:"gram",harga:999999}]};
describe("master compound cart",()=>{
 it("creates one compound line priced by master SKU, not ingredient prices",()=>{
  expect(masterCompoundCartRow(sku,null,draft,"request",true)).toMatchObject({key:"request",item_id:null,sale_item_id:"sku",nama_obat:"Obat Racik Master",harga:1200,qty:1,jenis:"racikan",satuan:"racikan"});
 });
 it("keeps official ingredient and dosage snapshots while using master selling identity",()=>{
  const formula={version_id:"v1",name:"Official",dosage_form:"sirup",dosage_instruction:"Official dose",ingredients:[{item_id:"i",name:"I",quantity:1,unit:"ml",unit_price:500}]};
  expect(masterCompoundCartRow(sku,formula,{...draft,formulaId:"v1"},"request",false)).toMatchObject({nama_obat:sku.name,harga:1200,official_version_id:"v1",aturan_pakai:"Official dose",ingredients:[{qty:1,satuan:"ml"}]});
 });
 it("requires master and valid composition and preserves custom recipe permissions",()=>{
  expect(()=>masterCompoundCartRow(null,null,draft,"request",true)).toThrow();
  expect(()=>masterCompoundCartRow(sku,null,{...draft,ingredients:[]},"request",true)).toThrow();
  expect(()=>masterCompoundCartRow(sku,null,draft,"request",false)).toThrow();
  expect(()=>masterCompoundCartRow(sku,null,{...draft,ingredients:[{...draft.ingredients[0],qty:NaN}]},"request",true)).toThrow();
 });
});
