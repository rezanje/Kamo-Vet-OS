"use client";

import { NumberInput } from "@/components/NumberInput";
import {useState} from "react";

/** Blank editing text avoids reinserting0; the PO payload remains numeric. */
export function PurchasePriceInput({price,onChange,label}:{price:number;onChange:(value:number)=>void;label:string}) {
 const [draft,setDraft]=useState<{price:number;text:string}|null>(null);
 const text=draft?.price===price?draft.text:price===0?"":String(price);
 return <NumberInput className="fi" type="number" inputMode="decimal" min={0} step="any" value={text} placeholder="Harga beli" title={label} aria-label={label}
  style={{width:110,minWidth:0}}
  onFocus={()=>{if(price===0)setDraft({price:0,text:""});}}
  onChange={event=>{
   const raw=event.target.value,next=Number(raw);
   const accepted=Number.isFinite(next)&&!event.target.validity.badInput;
   setDraft({price:accepted?next:price,text:raw});
   if(accepted)onChange(next);
  }}
  onBlur={event=>{if(event.currentTarget.validity.badInput)setDraft(null);}}
 />;
}
