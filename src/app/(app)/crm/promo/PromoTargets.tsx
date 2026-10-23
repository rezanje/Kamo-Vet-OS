"use client";
import {useState} from "react";
import {LocalTransactionDraft} from "@/components/LocalTransactionDraft";
import {SearchableMultiSelect, type MultiSelectItem, type MultiSelectCategory} from "@/components/SearchableMultiSelect";
const ids=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=20000&&value.every(v=>typeof v==='string'&&v.length<=120);
export function PromoTargets({userId,items,branches,categories,initialItemIds=[],initialBranchIds=[],scope="crm-promo-create"}:{userId:string;items:MultiSelectItem[];branches:MultiSelectItem[];categories?:MultiSelectCategory[];initialItemIds?:string[];initialBranchIds?:string[];scope?:string}){
 const [itemIds,setItemIds]=useState<string[]>(initialItemIds),[branchIds,setBranchIds]=useState<string[]>(initialBranchIds);
 return <>
  <LocalTransactionDraft userId={userId} scope={scope} state={{snapshot:{itemIds,branchIds},restore:v=>{if(!ids(v.itemIds)||!ids(v.branchIds))return false;setItemIds(v.itemIds);setBranchIds(v.branchIds);return true;},reset:()=>{setItemIds(initialItemIds);setBranchIds(initialBranchIds);}}}/>
  <div style={{gridColumn:"1 / -1",minWidth:0}}><label className="flab">Barang yang kena promo (kosongkan = semua barang)</label><SearchableMultiSelect name="item_ids" label="barang promo" options={items} categories={categories} value={itemIds} onChange={setItemIds}/></div>
  <div style={{gridColumn:"1 / -1",minWidth:0}}><label className="flab">Cabang (kosongkan = semua cabang)</label><SearchableMultiSelect name="branch_ids" label="cabang promo" options={branches} value={branchIds} onChange={setBranchIds}/></div>
 </>;
}
