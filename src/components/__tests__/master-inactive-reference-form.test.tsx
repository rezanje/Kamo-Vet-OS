// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("../../app/(app)/pos/sku/actions",()=>({simpanBarang:vi.fn()}));
import {BarangForm,type BarangRow} from "../../app/(app)/pos/sku/BarangForm";
let root:Root,host:HTMLDivElement;
const item:BarangRow={id:"item",name:"Barang lama",code:"SKU-OLD",item_type:"Persediaan",unit:"dus",upc:null,category_id:"inactive-cat",brand_id:"inactive-brand",brand_name:"Merek lama",supplier_id:"inactive-supplier",supplier_name:"Pemasok lama",substitute_item_id:"inactive-item",buy_unit:null,sell_price:100,buy_price:50,min_stock:0,min_buy:0,min_sell_qty:1,default_discount:0,is_active:true,tindakan_kategori:null};
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it("preserves existing inactive references in an unrelated SKU edit instead of silently clearing FKs",async()=>{
 await act(async()=>root.render(<BarangForm categories={[{id:"inactive-cat",name:"Kategori lama",parent_id:null,is_active:false}]} brands={[]} suppliers={[]} satuanMaster={[]} barangLain={[]} editing={item}/>));
 const data=new FormData(host.querySelector("form")!);
 for(const key of ["category_id","brand_id","supplier_id","substitute_item_id","unit"] as const)expect(data.get(key)).toBe(item[key]);
 expect(host.querySelector('select[name="brand_id"]')!.textContent).toContain("Merek lama (Nonaktif)");
 expect(host.querySelector('select[name="supplier_id"]')!.textContent).toContain("Pemasok lama (Nonaktif)");
});
it("offers no inactive-reference fallback when creating a new SKU",async()=>{
 await act(async()=>root.render(<BarangForm categories={[]} brands={[]} suppliers={[]} satuanMaster={[]} barangLain={[]} editing={null}/>));
 expect(host.querySelector('option[value="inactive-brand"]')).toBeNull();
 expect(host.querySelector('option[value="inactive-supplier"]')).toBeNull();
});
