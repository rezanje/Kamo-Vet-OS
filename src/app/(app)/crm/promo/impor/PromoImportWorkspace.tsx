"use client";

import { useState } from "react";
import Link from "next/link";
import { NumberInput } from "@/components/NumberInput";
import { previewPromoExcel, savePromoExcelBatch, validatePromoDraft } from "./actions";
import type { PromoExcelRow } from "@/lib/promo-excel";
import type { PromoReviewedRow } from "@/lib/promo-bulk";

const rupiah=(value:number|null|undefined)=>typeof value==="number"?`Rp${value.toLocaleString("id-ID",{maximumFractionDigits:2})}`:"—";
const persen=(value:number|null|undefined)=>typeof value==="number"?`${value.toLocaleString("id-ID",{maximumFractionDigits:2})}%`:"—";
const isFinalPrice=(row:{discount_type:string})=>row.discount_type==="final_price";

type Branch={id:string;name:string};
export function PromoImportWorkspace({branches,today}:{branches:Branch[];today:string}) {
  const [file,setFile]=useState<File|null>(null);
  const [rows,setRows]=useState<PromoReviewedRow[]>([]);
  const [name,setName]=useState("");
  const [from,setFrom]=useState(today);
  const [until,setUntil]=useState("");
  const [allBranches,setAllBranches]=useState(false);
  const [branchIds,setBranchIds]=useState<string[]>([]);
  const [valid,setValid]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [saved,setSaved]=useState(false);
  const [key,setKey]=useState(()=>crypto.randomUUID());

  function edit(index:number,field:keyof PromoExcelRow,value:string) {
    setRows(current=>current.map((row,i)=>i===index?{...row,[field]:value,error:null,item_name:null,normal_price:null,final_price:null,potongan:null,percent_off:null,matched_unit:null}:row));
    setValid(false);setSaved(false);setMessage("Baris berubah. Klik Validasi ulang sebelum menyimpan.");
  }
  // Harga normal depends on the chosen branches: a reviewed Harga Akhir batch must be re-validated when they change.
  function branchesChanged() {
    if(rows.some(isFinalPrice)){setValid(false);setSaved(false);setMessage("Cabang berubah. Klik Validasi ulang sebelum menyimpan: harga normal dicek ulang untuk cabang yang dipilih.");}
  }
  async function preview() {
    if(!file){setMessage("Pilih file Excel .xlsx terlebih dahulu.");return;}
    setBusy(true);setMessage("");setSaved(false);setValid(false);setKey(crypto.randomUUID());
    try {
      const form=new FormData();form.set("file",file);
      if(allBranches)form.set("allBranches","1");
      for(const id of branchIds)form.append("branchId",id);
      const result=await previewPromoExcel(form);
      setRows(result.rows);setValid(result.valid);setMessage(result.error??(result.valid?`${result.rows.length} baris valid. Periksa rinciannya sebelum menyimpan.`:"Perbaiki baris bertanda merah, lalu validasi ulang."));
    } catch {setMessage("Preview gagal dimuat. Coba file yang sama lagi.");}
    finally {setBusy(false);}
  }
  async function validate() {
    setBusy(true);setMessage("");setValid(false);
    try {
      const result=await validatePromoDraft(rows,{allBranches,branchIds});
      setRows(result.rows);setValid(result.valid);
      setMessage(result.error??(result.valid?`${result.rows.length} baris valid dan siap disimpan.`:"Masih ada baris yang perlu diperbaiki."));
    } catch {setMessage("Validasi gagal. Coba lagi sebelum menyimpan.");}
    finally {setBusy(false);}
  }
  async function save() {
    if(!valid||busy||saved)return;
    setBusy(true);setMessage("");
    try {
      const result=await savePromoExcelBatch({key,name,validFrom:from,validUntil:until,allBranches,branchIds,rows});
      setMessage(result.message);setSaved(result.ok);
      if(!result.ok)setValid(false);
    } catch {setMessage("Hasil simpan belum dapat dipastikan. Coba lagi dengan batch yang sama; sistem mencegah duplikasi.");}
    finally {setBusy(false);}
  }
  return <div style={{display:"grid",gap:14}}>
    <p style={{fontSize:12,color:"var(--tm)"}}>Gunakan <Link href="/crm/promo/impor/template">Format-Impor-Promo-VetOS.xlsx</Link>. Kolom wajib: Kode Barang, Satuan, Jenis Diskon (Persen/Nominal/Harga Akhir), Nilai Diskon. Maksimal 500 baris dan 1 MB; rumus Excel ditolak.</p>
    <p style={{fontSize:12,color:"var(--tm)"}}><b>Harga Akhir</b>: Nilai Diskon diisi <b>Harga akhir promo per barang dan satuan</b> (Rp, angka polos tanpa titik/koma/Rp, mis. 18500). Satuan ditulis persis seperti terdaftar (mis. 1/2KG, 400gr, 800GR, KG); salah ketik seperti 400g4 ditolak. Harga normal dibaca dari master pada cabang yang dipilih di bawah (pilih cabang sebelum preview); baris ditolak bila harga akhir sama/lebih tinggi dari harga normal, di bawah HPP, harga normal berbeda antar cabang, atau selisih harga normal dan harga akhir bukan rupiah bulat (kasir hanya memotong rupiah bulat). <b>Perhatian:</b> promo disimpan sebagai potongan nominal (harga normal − harga akhir) per satuan, jadi bila harga normal diubah SESUDAH promo disimpan, harga akhir ikut bergeser. Saat simpan, harga normal dicek ulang; bila berubah Anda diminta validasi ulang. Diskon golongan pelanggan, diskon manual, voucher, dan poin dihitung tambahan di luar promo ini, jadi <b>harga di kasir masih bisa berakhir lebih rendah dari Harga Akhir</b>. Selain itu setiap baris hanya mendapat satu promo, yaitu yang potongannya terbesar. Promo lain yang aktif di barang yang sama (mis. persen toko) dengan potongan lebih besar dipakai menggantikan promo Harga Akhir ini.</p>
    <div style={{display:"flex",gap:8,alignItems:"end",flexWrap:"wrap"}}>
      <label className="flab">File Excel (.xlsx)
        <input className="fi" type="file" disabled={busy||saved} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event=>{setFile(event.target.files?.[0]??null);setRows([]);setValid(false);setSaved(false);}} />
      </label>
      <button type="button" className="btn-def" disabled={busy||!file} onClick={preview}>Baca dan preview</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
      <label className="flab">Nama batch *<input className="fi" maxLength={40} disabled={busy||saved} value={name} onChange={event=>setName(event.target.value)} placeholder="Promo November" /></label>
      <label className="flab">Mulai *<input className="fi" type="date" disabled={busy||saved} value={from} onChange={event=>setFrom(event.target.value)} /></label>
      <label className="flab">Berakhir *<input className="fi" type="date" disabled={busy||saved} value={until} onChange={event=>setUntil(event.target.value)} /></label>
    </div>
    <div>
      <label className="flab" style={{display:"flex",alignItems:"center",gap:7}}><input type="checkbox" disabled={busy||saved} checked={allBranches} onChange={event=>{setAllBranches(event.target.checked);if(event.target.checked)setBranchIds([]);branchesChanged();}} /> Berlaku untuk semua cabang</label>
      {!allBranches&&<div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:6}}>
        {branches.map(branch=><label key={branch.id} style={{fontSize:12,display:"flex",gap:5,alignItems:"center"}}><input type="checkbox" disabled={busy||saved} checked={branchIds.includes(branch.id)} onChange={event=>{setBranchIds(current=>event.target.checked?[...current,branch.id]:current.filter(id=>id!==branch.id));branchesChanged();}}/>{branch.name}</label>)}
      </div>}
    </div>
    {message&&<p role="status" style={{color:saved?"#15803d":"var(--tm)",fontSize:12}}>{message}</p>}
    {rows.length>0&&<>
      <div style={{overflowX:"auto"}}><table className="tbl" style={{minWidth:1150}}>
        <thead><tr><th>Baris</th><th>Kode Barang</th><th>Barang</th><th>Satuan</th><th>Jenis Diskon</th><th>Nilai Diskon</th><th>Harga normal</th><th>Harga akhir</th><th>Potongan</th><th>% diskon</th><th>Validasi</th></tr></thead>
        <tbody>{rows.map((row,index)=><tr key={`${row.line}:${index}`}>
          <td>{row.line}</td>
          <td><input className="fi" disabled={busy||saved} aria-label={`Kode barang baris ${row.line}`} value={row.code} onChange={event=>edit(index,"code",event.target.value)}/></td>
          <td>{row.item_name??"—"}{row.matched_unit&&isFinalPrice(row)&&<div style={{fontSize:11,color:"var(--tm)"}}>Satuan cocok: {row.matched_unit}</div>}</td>
          <td><input className="fi" disabled={busy||saved} aria-label={`Satuan baris ${row.line}`} value={row.unit} onChange={event=>edit(index,"unit",event.target.value)}/></td>
          <td><select className="fi" disabled={busy||saved} aria-label={`Jenis diskon baris ${row.line}`} value={row.discount_type} onChange={event=>edit(index,"discount_type",event.target.value)}>
            <option value="percent">Persen</option><option value="nominal">Nominal</option><option value="final_price">Harga Akhir</option>
            {row.discount_type!=="percent"&&row.discount_type!=="nominal"&&row.discount_type!=="final_price"&&<option value={row.discount_type}>{row.discount_type||"Pilih jenis"}</option>}
          </select></td>
          <td><NumberInput className="fi" type="number" min={0} step="0.01" disabled={busy||saved} aria-label={`Nilai diskon baris ${row.line}`} value={row.discount_value} onChange={event=>edit(index,"discount_value",event.target.value)}/></td>
          <td>{isFinalPrice(row)?rupiah(row.normal_price):"—"}</td>
          <td>{isFinalPrice(row)?rupiah(row.final_price):"—"}</td>
          <td>{isFinalPrice(row)?rupiah(row.potongan):"—"}</td>
          <td>{isFinalPrice(row)?persen(row.percent_off):"—"}</td>
          <td style={{color:row.error?"#b91c1c":"#15803d"}}>{row.error??(valid?"Valid":"Perlu validasi ulang")}</td>
        </tr>)}</tbody>
      </table></div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <button type="button" className="btn-def" disabled={busy||saved} onClick={validate}>Validasi ulang</button>
        <button type="button" className="btn-acc" disabled={busy||!valid||saved} onClick={save}>{busy?"Memproses…":"Simpan seluruh batch"}</button>
        {saved&&<Link href="/crm/promo" className="back-btn">Lihat daftar promo</Link>}
      </div>
    </>}
  </div>;
}
