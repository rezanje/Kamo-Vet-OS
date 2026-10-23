"use client";

import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
export type SearchableItem={id:string;code:string;name:string};

/** IDs remain authoritative. Visible names and reference codes are separate. */
export function SearchableItemPicker({items,value,onChange,placeholder='Cari kode / nama barang',ariaLabel='Barang',selectedLabelFormat='name',inputId,textValue,onTextChange,readOnly=false}:{
 items:SearchableItem[];value:string;onChange:(id:string)=>void;placeholder?:string;ariaLabel?:string;
 selectedLabelFormat?:'code-name'|'name';inputId?:string;textValue?:string;onTextChange?:(text:string)=>void;readOnly?:boolean;
}){
 const selected=items.find(item=>item.id===value),label=(item:SearchableItem)=>selectedLabelFormat==='name'?item.name:`${item.code} · ${item.name}`;
 const [override,setOverride]=useState<{value:string;text:string}|null>(null),[open,setOpen]=useState(false),[highlight,setHighlight]=useState(-1),[limit,setLimit]=useState(50);
 const [bounds,setBounds]=useState<{left:number;top:number;width:number;height:number;above:boolean}|null>(null);
 const input=useRef<HTMLInputElement>(null),popup=useRef<HTMLDivElement>(null),listId=useId();
 const query=textValue??(override?.value===value?override.text:selected?label(selected):'');
 const matches=useMemo(()=>{const q=query.trim().toLowerCase();return q?items.filter(item=>`${item.code} ${item.name}`.toLowerCase().includes(q)):items;},[items,query]);
 const hits=matches.slice(0,limit);
 useEffect(()=>{
  if(!open)return;
  const position=()=>{const rect=input.current?.getBoundingClientRect();if(!rect)return;
   const below=window.innerHeight-rect.bottom-8,above=below<180&&rect.top>below,height=Math.max(60,Math.min(280,above?rect.top-8:below));
   setBounds({left:Math.max(4,Math.min(rect.left,window.innerWidth-rect.width-4)),top:above?rect.top-4:rect.bottom+4,width:Math.min(rect.width,window.innerWidth-8),height,above});
  };
  position();window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);};
 },[open]);
 useEffect(()=>{if(open&&highlight>=0)document.getElementById(`${listId}-option-${highlight}`)?.scrollIntoView?.({block:'nearest'});},[open,highlight,listId]);
 const close=()=>{setOpen(false);setOverride(null);setHighlight(-1);};
 const choose=(item:SearchableItem)=>{onChange(item.id);setOverride({value:item.id,text:label(item)});setOpen(false);setHighlight(-1);};
 return <div style={{position:'relative',minWidth:0}}>
  <input ref={input} id={inputId} className="fi" value={query} placeholder={placeholder} aria-label={ariaLabel} role="combobox" readOnly={readOnly}
   aria-autocomplete="list" aria-expanded={open&&!readOnly} aria-controls={listId} aria-activedescendant={open&&hits[highlight]?`${listId}-option-${highlight}`:undefined}
   onFocus={()=>{if(!readOnly)setOpen(true);}}
   onBlur={event=>{if(!event.currentTarget.parentElement?.contains(event.relatedTarget as Node|null)&&!popup.current?.contains(event.relatedTarget as Node|null))close();}}
   onChange={event=>{setOverride({value,text:event.target.value});onTextChange?.(event.target.value);setHighlight(-1);setLimit(50);setOpen(true);if(!onTextChange&&!event.target.value.trim())onChange('');}}
   onKeyDown={event=>{
    if(readOnly)return;
    if(event.key==='Escape'){event.preventDefault();close();}
    else if(event.key==='ArrowDown'&&hits.length){event.preventDefault();setOpen(true);setHighlight(i=>Math.min(i+1,hits.length-1));}
    else if(event.key==='ArrowUp'&&hits.length){event.preventDefault();setOpen(true);setHighlight(i=>Math.max(i-1,0));}
    else if(event.key==='Enter'&&open){event.preventDefault();if(hits[highlight])choose(hits[highlight]);}
   }}/>
  {selected?.code&&<small data-item-code style={{display:'block',color:'var(--tm)',fontSize:10,overflowWrap:'anywhere'}}>Kode: {selected.code}</small>}
  {value&&!selected&&<small role="status">Pilihan tersimpan tidak tersedia; pilih ulang untuk mengubahnya.</small>}
  {open&&!readOnly&&bounds&&createPortal(<div ref={popup} style={{position:'fixed',zIndex:1000,left:bounds.left,top:bounds.top,width:bounds.width,maxHeight:bounds.height,transform:bounds.above?'translateY(-100%)':undefined,overflowY:'auto',background:'#fff',border:'.5px solid var(--bd)',borderRadius:5,boxShadow:'0 2px 8px rgba(0,0,0,.1)'}}>
   <div id={listId} role="listbox" aria-label={`Hasil ${ariaLabel}`}>
    {hits.map((item,index)=><button id={`${listId}-option-${index}`} type="button" role="option" aria-selected={item.id===value} tabIndex={-1} key={item.id}
     onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)} style={{display:'block',width:'100%',border:0,borderBottom:'.5px solid var(--bd)',background:index===highlight?'var(--sf1, #f3f4f6)':'#fff',padding:'6px 9px',textAlign:'left',cursor:'pointer',fontSize:11,whiteSpace:'normal',overflowWrap:'anywhere'}}>
     <span>{item.name}</span>{item.code&&<small style={{display:'block',color:'var(--tm)'}}>Kode: {item.code}</small>}
    </button>)}
    {!hits.length&&<p style={{padding:8}}>Tidak ada hasil.</p>}
   </div>
   {hits.length<matches.length&&<button type="button" className="btn-def" onMouseDown={event=>event.preventDefault()} onClick={()=>{setLimit(n=>n+50);input.current?.focus();}}>Tampilkan lebih banyak ({hits.length}/{matches.length})</button>}
  </div>,document.body)}
 </div>;
}
