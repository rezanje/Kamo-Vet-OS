"use client";
import { NumberInput } from "@/components/NumberInput";
import {useState} from 'react';
import {LocalTransactionDraft,usePreservedAction} from '@/components/LocalTransactionDraft';
import {ProductionRequestIdentity} from '@/components/ProductionRequestIdentity';
import {SubmitButton} from '@/components/SubmitButton';
import {SearchableItemPicker} from '@/components/SearchableItemPicker';
import {hariIniWIB} from '@/lib/tanggal';
import type {BarangPilihan} from './ResepForm';
import {mulaiProduksiAdhoc} from './actions';
type Bahan={item_id:string;warehouse_id:string;qty:string;satuan:string};
type State={branch:string;output:string;outputUnit:string;outputQty:string;warehouse:string;rows:Bahan[]};
const blank=():State=>({branch:'',output:'',outputUnit:'',outputQty:'',warehouse:'',rows:[{item_id:'',warehouse_id:'',qty:'',satuan:''}]});
const valid=(v:unknown):v is State=>{if(!v||typeof v!=='object')return false;const s=v as State;return ['branch','output','outputUnit','outputQty','warehouse'].every(k=>typeof s[k as keyof State]==='string'&&String(s[k as keyof State]).length<=120)&&Array.isArray(s.rows)&&s.rows.length>0&&s.rows.length<=100&&s.rows.every(x=>x&&['item_id','warehouse_id','qty','satuan'].every(k=>typeof x[k as keyof Bahan]==='string'&&x[k as keyof Bahan].length<=120));};
type Props={userId:string;barang:BarangPilihan[];gudang:{id:string;name:string;branch_id:string}[];cabang:{id:string;name:string}[]};
export function ProductionAdhocForm(props:Props){return <AdhocForm key={props.userId} {...props}/>;}
function AdhocForm({userId,barang,gudang,cabang}:Props){
 const [s,set]=useState<State>(blank);const {save,failure}=usePreservedAction(mulaiProduksiAdhoc);
 const patch=(v:Partial<State>)=>set(x=>({...x,...v}));
 const row=(i:number,v:Partial<Bahan>)=>set(x=>({...x,rows:x.rows.map((r,n)=>n===i?{...r,...v}:r)}));
 const units=(id:string)=>{const item=barang.find(x=>x.id===id);return item?.units??(item?[{unit:item.unit,factor:1,sell_price:0,buy_price:0}]:[]);};
 const wh=gudang.filter(x=>x.branch_id===s.branch);
 return <form action={save}>
  <LocalTransactionDraft userId={userId} scope="production-adhoc-create" state={{snapshot:{job:s},restore:v=>{if(!valid(v.job))return false;set(v.job);return true;},reset:()=>set(blank())}}/>
  <ProductionRequestIdentity userId={userId} kind="start" mode="adhoc"/>
  {failure&&<p role="alert">{failure}</p>}
  <p>Tanpa master resep permanen. Gudang bahan, hasil dan konteks pekerjaan harus satu cabang. Mengubah cabang mengosongkan pilihan gudang. Modal berasal dari FIFO bahan aktual; biaya tambahan dan alokasi lintas cabang belum tersedia.</p>
  <div className="frow" style={{marginBottom:10}}>
   <div><label className="flab">Nama pekerjaan *</label><input className="fi" name="nama" maxLength={120} required/></div>
   <div><label className="flab">Cabang konteks *</label><select className="fi" aria-label="Cabang pekerjaan" name="branch_id" value={s.branch} required onChange={e=>set(x=>({...x,branch:e.target.value,warehouse:'',rows:x.rows.map(r=>({...r,warehouse_id:''}))}))}><option value="">Pilih cabang</option>{cabang.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
   <div><label className="flab">Tanggal bahan keluar *</label><input className="fi" name="tanggal" type="date" required defaultValue={hariIniWIB()}/></div>
  </div>
  <div className="frow" style={{marginBottom:10}}>
   <div><label className="flab">Barang hasil *</label><input type="hidden" name="output_item_id" value={s.output}/><SearchableItemPicker items={barang} value={s.output} ariaLabel="Barang hasil" selectedLabelFormat="name" onChange={id=>patch({output:id,outputUnit:units(id)[0]?.unit??''})}/>{s.output&&<small>Kode: {barang.find(x=>x.id===s.output)?.code??'Item tidak tersedia'}</small>}</div>
   <div><label className="flab">Rencana jumlah hasil *</label><NumberInput className="fi" name="output_qty" type="number" step="any" inputMode="decimal" required value={s.outputQty} onChange={e=>patch({outputQty:e.target.value})}/><select className="fi" name="output_unit" aria-label="Satuan hasil pekerjaan" required value={s.outputUnit} onChange={e=>patch({outputUnit:e.target.value})}><option value="">Pilih satuan</option>{units(s.output).map(x=><option key={x.unit} value={x.unit}>{x.unit}</option>)}</select></div>
   <div><label className="flab">Gudang hasil *</label><select className="fi" name="warehouse_id" aria-label="Gudang hasil" required value={s.warehouse} onChange={e=>patch({warehouse:e.target.value})}><option value="">Pilih gudang hasil</option>{wh.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
  </div>
  <input type="hidden" name="bahan" value={JSON.stringify(s.rows)}/>
  <strong>Bahan keluar</strong>
  {s.rows.map((r,i)=><div key={i} style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:8,alignItems:'end'}}>
   <div style={{flex:'1 1 200px'}}><label className="flab">Bahan {i+1}</label><SearchableItemPicker items={barang} value={r.item_id} ariaLabel={`Bahan ${i+1}`} selectedLabelFormat="name" onChange={id=>row(i,{item_id:id,satuan:units(id)[0]?.unit??''})}/>{r.item_id&&<small>Kode: {barang.find(x=>x.id===r.item_id)?.code??'Item tidak tersedia'}</small>}</div>
   <div style={{flex:'1 1 170px'}}><label className="flab">Gudang sumber</label><select className="fi" aria-label={`Gudang bahan ${i+1}`} required value={r.warehouse_id} onChange={e=>row(i,{warehouse_id:e.target.value})}><option value="">Pilih gudang sumber</option>{wh.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
   <div style={{flex:'1 1 140px'}}><label className="flab">Jumlah / satuan</label><NumberInput className="fi" aria-label={`Jumlah bahan ${i+1}`} type="number" step="any" inputMode="decimal" required value={r.qty} onChange={e=>row(i,{qty:e.target.value})}/><select className="fi" aria-label={`Satuan bahan ${i+1}`} required value={r.satuan} onChange={e=>row(i,{satuan:e.target.value})}><option value="">Pilih satuan</option>{units(r.item_id).map(x=><option key={x.unit} value={x.unit}>{x.unit}</option>)}</select></div>
   <button type="button" className="btn-def" aria-label={`Hapus bahan ${i+1}`} disabled={s.rows.length===1} onClick={()=>patch({rows:s.rows.filter((_,n)=>n!==i)})}>Hapus</button>
  </div>)}
  <button type="button" className="btn-def" disabled={s.rows.length>=100} style={{marginTop:10}} onClick={()=>patch({rows:[...s.rows,{item_id:'',warehouse_id:'',qty:'',satuan:''}]})}>Tambah bahan</button>
  <div style={{margin:'12px 0'}}><label className="flab">Catatan</label><input className="fi" name="catatan" maxLength={2000}/></div>
  <SubmitButton className="btn-acc" pendingText="Memproses…">Mulai pekerjaan ad hoc (bahan keluar)</SubmitButton>
 </form>;
}
