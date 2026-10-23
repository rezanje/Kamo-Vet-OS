"use client";

import {useState} from 'react';
import {SearchableItemPicker,type SearchableItem} from './SearchableItemPicker';

/** Single reference in master forms. Unavailable stored IDs survive unrelated edits. */
export function ItemReferenceField({name,items,defaultValue='',required=false,ariaLabel}:{name:string;items:SearchableItem[];defaultValue?:string;required?:boolean;ariaLabel:string}){
 return <ReferencePicker key={`${name}:${defaultValue}`} name={name} items={items} defaultValue={defaultValue} required={required} ariaLabel={ariaLabel}/>;
}
function ReferencePicker({name,items,defaultValue,required,ariaLabel}:{name:string;items:SearchableItem[];defaultValue:string;required:boolean;ariaLabel:string}){
 const [value,setValue]=useState(defaultValue);
 const [query,setQuery]=useState<string|null>(null);
 const text=query??items.find(item=>item.id===value)?.name??'';
 return <>
  <input type="hidden" name={name} value={value}/>
  <SearchableItemPicker items={items} value={value} textValue={text} required={required||Boolean(query?.trim())} ariaLabel={ariaLabel}
   onTextChange={text=>{setQuery(text);setValue('');}}
   onChange={id=>{setValue(id);setQuery(null);}}/>
 </>;
}
