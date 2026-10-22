"use client";
import {useState} from "react";
import {LocalTransactionDraft} from "@/components/LocalTransactionDraft";
import {SearchableMultiSelect} from "@/components/SearchableMultiSelect";
import type {SearchableItem} from "@/components/SearchableItemPicker";
const ids=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=20000&&value.every(v=>typeof v==='string'&&v.length<=120);
export function PromoTargets({userId,items,branches}:{userId:string;items:SearchableItem[];branches:SearchableItem[]}){
 const [itemIds,setItemIds]=useState<string[]>([]),[branchIds,setBranchIds]=useState<string[]>([]);
 return <>
  <LocalTransactionDraft userId={userId} scope="crm-promo-create" state={{snapshot:{itemIds,branchIds},restore:v=>{if(!ids(v.itemIds)||!ids(v.branchIds))return false;setItemIds(v.itemIds);setBranchIds(v.branchIds);return true;},reset:()=>{setItemIds([]);setBranchIds([]);}}}/>
  <div style={{gridColumn:"1 / -1",minWidth:0}}><label className="flab">Barang yang kena promo (kosongkan = semua barang)</label><SearchableMultiSelect name="item_ids" label="barang promo" options={items} value={itemIds} onChange={setItemIds}/></div>
  <div style={{gridColumn:"1 / -1",minWidth:0}}><label className="flab">Cabang (kosongkan = semua cabang)</label><SearchableMultiSelect name="branch_ids" label="cabang promo" options={branches} value={branchIds} onChange={setBranchIds}/></div>
 </>;
}
