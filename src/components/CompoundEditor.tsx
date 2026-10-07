"use client";
import { useState } from "react";
import type { CompoundDraft, CompoundSaleSku } from "@/lib/master-compound-cart";
import type { KatalogRacikan } from "@/lib/katalog-racikan";
const rp=(value:number)=>"Rp "+Math.round(value).toLocaleString("id-ID");
export function CompoundEditor<T extends CompoundSaleSku>({ items, materials, catalog, allowCustom, value, onChange, onAdd, onAddStock, submitLabel="Tambah racikan ke keranjang" }: {
  items:T[];materials:CompoundSaleSku[];catalog:KatalogRacikan[];allowCustom:boolean;
  value:CompoundDraft;onChange:(value:CompoundDraft)=>void;onAdd?:()=>void;onAddStock?:(item:T)=>void;submitLabel?:string;
}) {
  const [search,setSearch]=useState(""),[materialSearch,setMaterialSearch]=useState(""),[page,setPage]=useState(1),[materialPage,setMaterialPage]=useState(1);
  const sku=items.find(item=>item.id===value.saleItemId);
  const boundCatalog=sku?catalog.filter(row=>row.active&&row.sale_item_id===sku.id):[];
  const formula=boundCatalog.find(row=>row.version_id===value.formulaId);
  const term=search.trim().toLowerCase(),materialTerm=materialSearch.trim().toLowerCase();
  const matches=term?items.filter(item=>`${item.name} ${item.code??""}`.toLowerCase().includes(term)):[];
  const materialMatches=materialTerm?materials.filter(item=>`${item.name} ${item.code??""}`.toLowerCase().includes(materialTerm)):[];
  const pages=Math.max(1,Math.ceil(matches.length/40)),currentPage=Math.min(page,pages);
  const materialPages=Math.max(1,Math.ceil(materialMatches.length/40)),currentMaterialPage=Math.min(materialPage,materialPages);
  const valid=!!sku&&(!!formula || (!value.formulaId&&allowCustom&&value.ingredients.length>0&&value.ingredients.every(row=>Number.isFinite(row.qty)&&row.qty>0)));
  return <section aria-label="Editor obat racik" style={{ display:"flex",flexDirection:"column",gap:8 }}>
    <strong style={{fontSize:12}}>Obat racik dari Barang &amp; Jasa</strong>
    <input className="fi" aria-label="Cari obat racik" placeholder="Cari nama / kode obat racik…" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} />
    {term&&<div style={{maxHeight:200,overflowY:"auto",display:"grid",gap:4}}>
      {matches.slice((currentPage-1)*40,currentPage*40).map(item=><button key={item.id} type="button" className="btn-def" aria-label={`Pilih ${item.name}`} onClick={()=>{onChange({...value,saleItemId:item.id,formulaId:value.saleItemId===item.id?value.formulaId:""});setSearch("");}} style={{display:"flex",justifyContent:"space-between",textAlign:"left"}}>
        <span>{item.name}<small style={{display:"block",color:"var(--tm)"}}>Stok obat jadi {item.stok} {item.unit}</small></span><span>{rp(item.sell_price)}</span>
      </button>)}
      {!matches.length&&<span style={{fontSize:11,color:"var(--tm)"}}>Tidak ada obat racik yang cocok.</span>}
      {pages>1&&<div style={{display:"flex",gap:8}}><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Sebelumnya</button><span>{currentPage}/{pages}</span><button type="button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Berikutnya</button></div>}
    </div>}
    {!items.length&&<span style={{fontSize:11,color:"var(--tm)"}}>Belum ada SKU aktif pada kategori Obat Racik di Barang &amp; Jasa.</span>}
    {sku&&<div style={{padding:10,border:".5px solid var(--bd)",borderRadius:8}}>
      <strong>{sku.name}</strong><div style={{fontSize:12}}>Harga jual {rp(sku.sell_price)} · satu hasil racikan</div>
      {onAddStock&&<button type="button" className="btn-def" style={{marginTop:8}} onClick={()=>onAddStock(sku)}>Ambil stok obat jadi</button>}
    </div>}
    <label className="flab">Komposisi racikan</label>
    <select className="fi" aria-label="Komposisi racikan" value={value.formulaId} onChange={event=>onChange({...value,formulaId:event.target.value})}>
      <option value="">{allowCustom?"Racikan khusus pasien":"Pilih resep resmi"}</option>
      {boundCatalog.map(row=><option key={row.version_id} value={row.version_id}>{row.code} · {row.name} (v{row.version})</option>)}
    </select>
    {sku&&!boundCatalog.length&&<span style={{fontSize:11,color:"var(--tm)"}}>Resep resmi belum ditautkan ke SKU ini. OWNER/ADMIN dapat mengaturnya di Katalog Racikan Resmi.</span>}
    {formula?<div style={{fontSize:11,padding:9,background:"#f4f0ff",borderRadius:8}}>
      <strong>{formula.name} · {formula.dosage_form}</strong>
      <div>{formula.ingredients.map(row=>`${row.name} ${row.quantity} ${row.unit}`).join(" · ")}</div>
      <div>Aturan pakai: {formula.dosage_instruction??"Tidak ditetapkan"}</div>
    </div>:allowCustom?<>
      <div style={{display:"flex",gap:6}}><select className="fi" aria-label="Bentuk racikan" value={value.dosageForm} onChange={event=>onChange({...value,dosageForm:event.target.value})}>
        {["sirup","nebul","salep","puyer","kapsul","lainnya"].map(form=><option key={form}>{form}</option>)}
      </select><input className="fi" aria-label="Aturan pakai racikan" placeholder="Aturan pakai (opsional)" value={value.instruction} onChange={event=>onChange({...value,instruction:event.target.value})} /></div>
      <input className="fi" aria-label="Cari bahan racikan" placeholder="Cari bahan baku..." value={materialSearch} onChange={event=>{setMaterialSearch(event.target.value);setMaterialPage(1);}} />
      {materialTerm&&<div style={{maxHeight:160,overflowY:"auto",display:"grid",gap:4}}>
        {materialMatches.slice((currentMaterialPage-1)*40,currentMaterialPage*40).map(item=><button key={item.id} type="button" className="btn-def" aria-label={`Pilih bahan ${item.name}`} style={{textAlign:"left"}} onClick={()=>{
          const exists=value.ingredients.some(row=>row.item_id===item.id);
          onChange({...value,ingredients:exists?value.ingredients.map(row=>row.item_id===item.id?{...row,qty:row.qty+1}:row):[...value.ingredients,{item_id:item.id,nama:item.name,qty:1,satuan:item.unit,harga:item.sell_price}]});setMaterialSearch("");
        }}>{item.name}<small style={{display:"block",color:"var(--tm)"}}>Stok {item.stok} {item.unit}</small></button>)}
        {!materialMatches.length&&<span style={{fontSize:11,color:"var(--tm)"}}>Tidak ada bahan yang cocok.</span>}
        {materialPages>1&&<div style={{display:"flex",gap:8}}><button type="button" disabled={currentMaterialPage===1} onClick={()=>setMaterialPage(currentMaterialPage-1)}>Sebelumnya</button><span>{currentMaterialPage}/{materialPages}</span><button type="button" disabled={currentMaterialPage===materialPages} onClick={()=>setMaterialPage(currentMaterialPage+1)}>Berikutnya</button></div>}
      </div>}
      {value.ingredients.map(row=><div key={row.item_id} style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{flex:1,fontSize:11}}>{row.nama}</span><input className="fi" aria-label={`Jumlah bahan ${row.nama}`} type="number" min={0.001} step="any" value={row.qty||""} style={{width:70}} onChange={event=>onChange({...value,ingredients:value.ingredients.map(ingredient=>ingredient.item_id===row.item_id?{...ingredient,qty:Number(event.target.value)}:ingredient)})} /><span style={{fontSize:11}}>{row.satuan}</span>
        <button type="button" className="btn-def" aria-label={`Hapus bahan ${row.nama}`} onClick={()=>onChange({...value,ingredients:value.ingredients.filter(ingredient=>ingredient.item_id!==row.item_id)})}>×</button>
      </div>)}
    </>:null}
    <span style={{fontSize:10,color:"var(--tm)"}}>Stok bahan diperiksa saat menyimpan racikan.</span>
    <button type={onAdd?"button":"submit"} className="btn-acc" disabled={!valid} onClick={onAdd}>{submitLabel}</button>
  </section>;
}
