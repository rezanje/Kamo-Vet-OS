"use client";
import { useState, type ComponentProps } from "react";
import Link from "next/link";
import { ItemTable, type MasterItem } from "./PembayaranForm";
import { SimpanBayarForm } from "../../rawat-inap/[id]/tagihan/SimpanBayarForm";
import type { InpatientCashierData } from "@/lib/inpatient-cashier";

type Line = ComponentProps<typeof ItemTable>["rows"][number];
const rp=(n:number)=>`Rp ${Math.round(n).toLocaleString("id-ID")}`;
export function InpatientCashier({data,visitId,recordId,requestKey,masterObat,masterJasa,ppnRate,minDpPercent,bolehTerobos}: {
 data:InpatientCashierData;visitId:string;recordId:string;requestKey:string;masterObat:MasterItem[];masterJasa:MasterItem[];ppnRate:number;minDpPercent:number;bolehTerobos:boolean;
}) {
 const initial=(kind:string):Line[]=>data.rows.filter(row=>(row.jenis==="jasa"?"jasa":"obat")===kind).map(row=>({
  key:row.id,prescription_item_id:row.id,item_id:row.item_id,deskripsi:row.nama_obat,qty:Number(row.qty),harga:Number(row.harga),satuan:row.satuan,
  recipe_id:row.compound_recipe_id,service_performers:row.service_performers,terkunci:!!row.compound_recipe_id,diskon_persen:0,
 }));
 const [obat,setObat]=useState(()=>initial("obat"));
 const [jasa,setJasa]=useState(()=>initial("jasa"));
 const [reason,setReason]=useState("Konfirmasi keranjang rawat inap");
 const rows=[...obat,...jasa];
 const subtotal=rows.reduce((s,row)=>s+row.qty*row.harga,0);
 const pending=subtotal+Math.round(subtotal*ppnRate/100);
 const remaining=Math.max(0,data.quote.debt+pending-data.quote.credit);
 const billed=data.history.reduce((s,i)=>s+Number(i.total),0);
 const received=data.history.reduce((s,i)=>s+Number(i.received),0);
 const hasPrior=data.history.some(i=>i.total>0&&!i.correction_pending);
 const payload=rows.map(row=>({id:row.key??row.prescription_item_id,item_id:row.item_id??null,nama_obat:row.deskripsi,qty:row.qty,harga:row.harga,satuan:row.satuan??null,
  jenis:jasa.includes(row)?"jasa":"obat",compound_recipe_id:row.recipe_id??null,service_performers:row.service_performers??null,diskon_persen:row.diskon_persen??0}));
 return <>
  <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:8,marginBottom:12}}>
   {[['Total transaksi',billed+pending],['DP / sudah dibayar',received],['Sisa pembayaran',remaining]].map(([label,value])=><div key={String(label)} className="card"><b>{label}</b><div style={{fontSize:23,fontWeight:800}}>{rp(Number(value))}</div></div>)}
  </div>
  <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(320px,390px)",gap:12,alignItems:"start"}}>
   <section className="crm-sec"><h2 style={{fontSize:16}}>KERANJANG BELUM DITAGIH</h2>
    <p style={{fontSize:11}}>Hanya biaya pending yang dapat direvisi. Baris yang dihapus tetap ada dalam rekam medis dengan catatan pembatalan penagihan. Invoice lama, DP dan racikan yang sudah dibuat tidak ditulis ulang.</p>
    <ItemTable title="OBAT" icon="ti-pill" color="#15803d" rows={obat} setRows={setObat} master={masterObat} listId="ranap-obat" allowUnits sealedPerformers discountsDisabled/>
    <ItemTable title="JASA / TINDAKAN" icon="ti-stethoscope" color="#2563eb" rows={jasa} setRows={setJasa} master={masterJasa} listId="ranap-jasa" allowUnits sealedPerformers discountsDisabled/>
    {data.rows.filter(row=>row.compound_recipe_id).map(row=><p key={row.id}>Racikan {row.nama_obat}: <Link href={`/klinik/racik/${row.compound_recipe_id}`}>Aksi koreksi / pengembalian bahan</Link> (tidak dikeluarkan ulang saat bayar).</p>)}
    <label className="flab">Alasan / catatan revisi keranjang<input className="fi" aria-label="Alasan revisi keranjang" value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={1000}/></label>
    <p style={{fontSize:11}}>Promo, voucher, poin dan diskon nota/baris tidak berlaku pada invoice tahap rawat inap.</p>
   </section>
   <section className="crm-sec"><h2 style={{fontSize:17}}>PEMBAYARAN</h2>
    <p>Saldo pemilik: <b>{rp(data.quote.credit)}</b></p>
    <p>{hasPrior?`DP lanjutan opsional: ${rp(Math.round(remaining/2))}`:`DP awal minimal ${minDpPercent}%: ${rp(Math.ceil(pending*minDpPercent/100))}`}</p>
    <SimpanBayarForm recordId={recordId} visitId={visitId} requestKey={requestKey} remaining={remaining} pendingCount={rows.length} accounts={data.quote.accounts}
     compoundPending={data.compound_pending}
     applyCredit={Math.min(data.quote.credit,data.quote.debt)} bolehTerobos={bolehTerobos} dpOpsional={hasPrior?Math.round(remaining/2):undefined}
     extraFields={{pending_snapshot:data.snapshot,pending_rows:JSON.stringify(payload),cart_reason:reason}}/>
   </section>
  </div>
 </>;
}
