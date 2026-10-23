"use client";
import {useEffect,useId,useMemo,useRef,useState} from "react";
import type {SearchableItem} from "./SearchableItemPicker";

export type MultiSelectItem = SearchableItem & { categoryId?: string | null; categoryLabel?: string };
export type MultiSelectCategory = { id: string; label: string; includes: string[] };

/** Repeated hidden IDs retain the existing checkbox submission contract. */
export function SearchableMultiSelect({name,label,options,categories,value,onChange}:{name:string;label:string;options:MultiSelectItem[];categories?:MultiSelectCategory[];value:string[];onChange:(ids:string[])=>void}) {
 const [category,setCategory]=useState("");
 const [query,setQuery]=useState(""),[open,setOpen]=useState(false),[highlight,setHighlight]=useState(-1),[limit,setLimit]=useState(50);
 const listId=useId(),input=useRef<HTMLInputElement>(null);
 const selected=new Set(value),byId=new Map(options.map(o=>[o.id,o]));
 const missing=[...selected].filter(id=>!byId.has(id));
 const hits=useMemo(()=>{const q=query.trim().toLowerCase();const group=category?categories?.find(c=>c.id===category):undefined;return options.filter(o=>(!category||!!group?.includes.includes(o.categoryId??""))&&`${o.code} ${o.name}`.toLowerCase().includes(q));},[options,query,category,categories]);
 const shown=hits.slice(0,limit);
 useEffect(()=>{input.current?.setCustomValidity(missing.length?"Ada pilihan yang tidak tersedia. Periksa dan lepaskan pilihan tersebut sebelum menyimpan.":"");},[missing.length]);
 const toggle=(id:string)=>{const next=new Set(value);if(next.has(id))next.delete(id);else next.add(id);onChange([...next]);};
 const all=(pick:boolean)=>{const next=new Set(value);for(const o of hits){if(pick)next.add(o.id);else next.delete(o.id);}onChange([...next]);};
 const search=(text:string)=>{setQuery(text);setOpen(true);setHighlight(-1);setLimit(50);};
 return <div style={{minWidth:0,maxWidth:"100%",fontSize:12}} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOpen(false);}}>
  {[...selected].map(id=><input key={id} type="hidden" name={name} value={id}/>)}
  {categories&&<label style={{display:"block",marginBottom:6}}>Kategori {label}<select className="fi" aria-label={`Kategori ${label}`} value={category} style={{display:"block",width:"100%",minWidth:0}} onChange={e=>{setCategory(e.target.value);setOpen(true);setHighlight(-1);setLimit(50);}}>
   <option value="">Semua kategori</option>{categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
  </select></label>}
  <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
   <input ref={input} className="fi" role="combobox" aria-label={`Cari ${label}`} placeholder={`Cari kode / nama ${label}`} value={query} aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-invalid={missing.length>0||undefined}
    aria-activedescendant={open&&shown[highlight]?`${listId}-${highlight}`:undefined} style={{minWidth:0,width:"100%"}}
    onFocus={()=>setOpen(true)} onChange={e=>search(e.target.value)} onKeyDown={e=>{
     if(e.key==='Escape'){e.preventDefault();setOpen(false);setHighlight(-1);}
     else if(e.key==='ArrowDown'){e.preventDefault();setOpen(true);setHighlight(i=>Math.min(i+1,shown.length-1));}
     else if(e.key==='ArrowUp'){e.preventDefault();setOpen(true);setHighlight(i=>Math.max(i-1,0));}
     else if(e.key==='Enter'){e.preventDefault();if(open&&shown[highlight])toggle(shown[highlight].id);}
    }}/>
   {query&&<button type="button" className="btn-def" aria-label={`Bersihkan pencarian ${label}`} onClick={()=>{search("");input.current?.focus();}}>×</button>}
  </div>
  <div aria-live="polite" style={{marginTop:4,color:"var(--tm)"}}>{selected.size} dipilih · {hits.length} hasil pencarian</div>
  {selected.size>0&&<div aria-label={`Pilihan ${label}`} style={{display:"flex",flexWrap:"wrap",gap:4,maxHeight:100,overflowY:"auto",marginTop:6}}>
   {[...selected].map(id=>{const o=byId.get(id);const text=o?`${o.code} · ${o.name}`:`Pilihan tidak tersedia (${id.slice(0,8)})`;return <button key={id} type="button" className="btn-def" aria-label={`Lepas ${text}`} onClick={()=>toggle(id)} style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere",textAlign:"left",fontSize:11}}>{text} ×</button>;})}
  </div>}
  {missing.length>0&&<p role="alert">{missing.length} pilihan tidak tersedia. Lepaskan secara eksplisit atau periksa daftar; pilihan tidak dihapus otomatis.</p>}
  {open&&<div style={{border:"1px solid var(--bd)",borderRadius:6,padding:6,marginTop:5,minWidth:0}}>
   <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:5}}>
    <button type="button" className="btn-def" disabled={!hits.length} onMouseDown={e=>e.preventDefault()} onClick={()=>all(true)}>Pilih semua hasil ({hits.length})</button>
    <button type="button" className="btn-def" disabled={!hits.length} onMouseDown={e=>e.preventDefault()} onClick={()=>all(false)}>Lepas semua hasil ({hits.length})</button>
   </div>
   <div id={listId} role="listbox" aria-label={`Hasil ${label}`} aria-multiselectable="true" style={{maxHeight:220,overflowY:"auto",minWidth:0}}>
    {shown.map((o,i)=><button key={o.id} id={`${listId}-${i}`} type="button" role="option" aria-selected={selected.has(o.id)} tabIndex={-1} onMouseDown={e=>e.preventDefault()} onClick={()=>toggle(o.id)} style={{display:"block",width:"100%",textAlign:"left",whiteSpace:"normal",overflowWrap:"anywhere",padding:7,border:0,background:i===highlight?"#eff6ff":"transparent",fontSize:12}}>{selected.has(o.id)?"✓ ":""}{o.code} · {o.name}{o.categoryLabel&&<span style={{display:"block",fontSize:11,color:"var(--tm)"}}>{o.categoryLabel}</span>}</button>)}
    {!hits.length&&<p>Tidak ada hasil.</p>}
   </div>
   {shown.length<hits.length&&<button type="button" className="btn-def" onClick={()=>setLimit(n=>n+50)}>Tampilkan lebih banyak ({shown.length}/{hits.length})</button>}
   <p style={{fontSize:11,marginBottom:0}}>Pilih/lepas semua berlaku untuk seluruh hasil filter dan pencarian ini, termasuk yang belum ditampilkan. Pilihan di luar filter tetap disimpan.</p>
  </div>}
 </div>;
}
