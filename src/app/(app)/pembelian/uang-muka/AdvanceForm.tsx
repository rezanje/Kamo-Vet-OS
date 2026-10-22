"use client";
import {useEffect,useRef,useState} from "react";
import Decimal from "decimal.js";
import {LocalTransactionDraft,PreservedForm,usePreservedAction} from "@/components/LocalTransactionDraft";
import {transactionDraftName} from "@/components/TransactionDraft";
import {SubmitButton} from "@/components/SubmitButton";
import {PilihRekening,type RekeningOpsi} from "@/components/PilihRekening";
import {METODE_BAYAR} from "@/lib/kas-akun";
import {hariIniWIB} from "@/lib/tanggal";
import {bayarUangMuka,periksaUangMuka} from "./actions";
export type AdvancePO={id:string;no_po:string|null;supplier_id:string|null;status:string;total:number};
type Balance={po_id:string|null;status:string;jumlah:number};
const rp=(n:Decimal.Value)=>"Rp "+new Decimal(n).toNumber().toLocaleString("id-ID",{maximumFractionDigits:2});
export function AdvanceForm({userId,suppliers,orders,advances,rekening}:{userId:string;suppliers:{id:string;nama:string}[];orders:AdvancePO[];advances:Balance[];rekening:RekeningOpsi[]}) {
 const [supplierId,setSupplierId]=useState(""),[poId,setPoId]=useState("");
 const nominal=useRef<HTMLInputElement>(null);
 const {save:recover,failure}=usePreservedAction(periksaUangMuka);
 const po=orders.find(row=>row.id===poId);
 let valuationValid=false;
 let issue="",total=new Decimal(0),used=new Decimal(0),remaining=new Decimal(0);
 try {
  if(po){total=new Decimal(po.total);used=advances.filter(a=>a.po_id===po.id&&a.status==='aktif').reduce((sum,a)=>sum.plus(a.jumlah),new Decimal(0));remaining=Decimal.max(0,total.minus(used));
   valuationValid=total.isFinite()&&used.isFinite()&&remaining.isFinite()&&total.gt(0)&&used.gte(0);
   if(!valuationValid)issue="Batas DP PO tidak dapat diverifikasi. Muat ulang dan periksa sumber.";
   else if(!['Draft','Dipesan'].includes(po.status))issue="PO sudah diterima atau tidak aktif; DP baru ditolak.";
   else if(po.supplier_id&&po.supplier_id!==supplierId)issue="Pemasok harus sesuai PO yang dipilih.";
   else if(remaining.lt(1))issue="Sisa batas DP PO sudah habis untuk pembayaran rupiah bulat.";
  }else if(poId)issue="PO draf tidak tersedia. Pilih PO yang valid; tautan tidak dilepas otomatis.";
 }catch{issue="Batas DP PO tidak dapat diverifikasi. Muat ulang dan periksa sumber.";}
 useEffect(()=>{nominal.current?.setCustomValidity(issue)},[issue]);
 const available=orders.filter(row=>['Draft','Dipesan'].includes(row.status));
 return <PreservedForm action={bayarUangMuka}>
  <LocalTransactionDraft userId={userId} scope="purchase-advance" state={{snapshot:{supplierId,poId},restore:snapshot=>{
   // Preserve older drafts whose fields predate the controlled PO-cap summary.
   const old=JSON.parse(sessionStorage.getItem(transactionDraftName(userId,'transaction','purchase-advance'))??'null')?.fields??{};
   const supplier=snapshot.supplierId??old.supplier_id??'',order=snapshot.poId??old.po_id??'';
   if(typeof supplier!=='string'||typeof order!=='string'||supplier.length>120||order.length>120)return false;
   setSupplierId(supplier);setPoId(order);return true;
  },reset:()=>{setSupplierId('');setPoId('')}}}/>
  <div className="frow" style={{flexWrap:"wrap"}}>
   <div><label className="flab" htmlFor="advance-supplier">Pemasok *</label><select id="advance-supplier" className="fi" name="supplier_id" value={supplierId} onChange={e=>setSupplierId(e.target.value)} required>
    <option value="">— pilih pemasok —</option>{supplierId&&!suppliers.some(s=>s.id===supplierId)&&<option value={supplierId} disabled>Pemasok draf tidak tersedia</option>}{suppliers.map(s=><option key={s.id} value={s.id}>{s.nama}</option>)}
   </select></div>
   <div><label className="flab" htmlFor="advance-po">Untuk PO (opsional)</label><select id="advance-po" className="fi" name="po_id" value={poId} onChange={e=>setPoId(e.target.value)}>
    <option value="">— belum terkait PO —</option>{poId&&!available.some(p=>p.id===poId)&&<option value={poId} disabled>{po?.no_po??'PO draf tidak tersedia'} · {po?.status??'periksa kembali'}</option>}{available.map(p=><option key={p.id} value={p.id}>{p.no_po??p.id.slice(0,8)}</option>)}
   </select></div>
   <div><label className="flab" htmlFor="advance-date">Tanggal</label><input id="advance-date" className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()}/></div>
  </div>
  {po&&valuationValid&&<div role="status" className="p2ban" style={{overflowWrap:"anywhere"}}>Nilai PO: {rp(total)} · DP aktif: {rp(used)} · Sisa batas: {rp(remaining)}. DP aktif menghitung seluruh nominal, termasuk yang sudah terpakai.</div>}
  {issue&&<p role="alert">{issue}</p>}
  {!poId&&<p style={{fontSize:11,color:"var(--tm)"}}>DP belum terkait PO mengikuti alur pemasok yang sudah ada; tidak dihitung sebagai sisa batas PO tertentu.</p>}
  <div className="frow" style={{flexWrap:"wrap"}}>
   <div><label className="flab" htmlFor="advance-amount">Nominal (Rp) *</label><input ref={nominal} id="advance-amount" className="fi" name="jumlah" type="number" min={1} step={1} max={po&&valuationValid?remaining.floor().toString():undefined} required/><div style={{fontSize:10}}>Gunakan rupiah bulat agar nominal DP sama dengan jurnal.</div></div>
   <div><label className="flab" htmlFor="advance-method">Metode</label><select id="advance-method" className="fi" name="metode" defaultValue="Transfer">{METODE_BAYAR.map(method=><option key={method}>{method}</option>)}</select></div>
   <PilihRekening rekening={rekening} label="Dibayar dari" width={170}/>
   <div><label className="flab" htmlFor="advance-note">Catatan</label><input id="advance-note" className="fi" name="catatan" placeholder="opsional"/></div>
   <div style={{display:"flex",alignItems:"flex-end"}}><SubmitButton className="btn-acc" disabled={!!issue} pendingText="Menyimpan…">Bayar uang muka</SubmitButton></div>
  </div>
  {failure&&<p role="alert">{failure}</p>}
  <button type="submit" formNoValidate formAction={recover} className="btn-def">Periksa hasil DP terakhir tanpa posting ulang</button>
 </PreservedForm>;
}
