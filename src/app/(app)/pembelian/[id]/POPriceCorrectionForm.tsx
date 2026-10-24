"use client";
import {useState}from 'react';
import {CorrectionTransactionForm}from '@/components/CorrectionTransactionForm';
import {PurchasePriceInput}from '@/components/PurchasePriceInput';
import {formatPosMoney,PosDecimal}from '@/lib/pos-money';
import {ubahHargaPO}from '../actions';
type Row={id:string;nama:string;qty:number;satuan?:string|null;harga_beli:number};
export function POPriceCorrectionForm({userId,poId,revision,rows,originalTotal,activeAdvances}:{userId:string;poId:string;revision:number;rows:Row[];originalTotal:number;activeAdvances:number}){
 const initial=()=>rows.map(r=>({id:r.id,harga_beli:Number(r.harga_beli)}));
 const[prices,setPrices]=useState(initial);
 const total=prices.reduce((sum,p)=>sum.plus(new PosDecimal(p.harga_beli).times(rows.find(r=>r.id===p.id)?.qty??0)),new PosDecimal(0));
 const valid=prices.length>0&&prices.every(p=>Number.isFinite(p.harga_beli)&&p.harga_beli>=0&&p.harga_beli<=1e12&&new PosDecimal(p.harga_beli).decimalPlaces()<=2)&&total.isFinite()&&total.gt(0)&&total.decimalPlaces()<=2&&total.gte(activeAdvances);
 return <CorrectionTransactionForm userId={userId} scope={`purchase-order-prices:${poId}:${revision}`} action={ubahHargaPO} state={{snapshot:{prices},reset:()=>setPrices(initial()),restore:value=>{
  if(!Array.isArray(value.prices)||value.prices.length!==rows.length||new Set(value.prices.map(p=>p?.id)).size!==rows.length||!value.prices.every(p=>p&&rows.some(r=>r.id===p.id)&&typeof p.harga_beli==='number'&&Number.isFinite(p.harga_beli)&&p.harga_beli>=0&&p.harga_beli<=1e12))return false;
  setPrices(value.prices);return true;
 }}}>{({ready})=><>
  <input type="hidden" name="id" value={poId}/><input type="hidden" name="revision" value={revision}/><input type="hidden" name="items" value={JSON.stringify(prices)}/>
  <p>Harga saja yang dikoreksi. Barang, jumlah, satuan, pemasok dan bukti DP tetap tersimpan.</p>
  <p>Total awal {formatPosMoney(originalTotal)} · DP aktif {formatPosMoney(activeAdvances)} · Total baru <strong>{formatPosMoney(total.toNumber())}</strong></p>
  {prices.map((p,i)=>{const row=rows.find(r=>r.id===p.id)!;return <div key={p.id} style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:8}}><span style={{flex:'1 1 200px',overflowWrap:'anywhere'}}>{row.nama} · {row.qty} {row.satuan??'unit'}</span><PurchasePriceInput label={`Harga PO ${i+1}`} price={p.harga_beli} onChange={price=>setPrices(values=>values.map(v=>v.id===p.id?{...v,harga_beli:price}:v))}/></div>;})}
  {!valid&&<p role="alert">Isi harga maksimal 2 desimal; total baru harus positif dan tidak boleh di bawah DP aktif.</p>}
  <label className="flab">Alasan perubahan *</label><input className="fi" name="alasan" required minLength={3} maxLength={1000} placeholder="Contoh: harga terbaru dari pemasok"/>
  <button type="submit" className="btn-acc" disabled={!ready||!valid}>Simpan koreksi harga</button>
 </>}</CorrectionTransactionForm>;
}
