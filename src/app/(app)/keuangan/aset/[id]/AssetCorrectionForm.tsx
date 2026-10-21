"use client";

import { useRef, useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import type { AssetCorrectionPreview } from "@/lib/asset-correction";
import { hariIniWIB } from "@/lib/tanggal";
import { koreksiPembelianAset, previewKoreksiAset } from "./correction-actions";

const rp=(value?:number)=>`Rp ${Number(value??0).toLocaleString("id-ID",{maximumFractionDigits:20})}`;
const signature=(form:HTMLFormElement)=>JSON.stringify(["id","revision","tanggal","harga","alasan"].map(name=>new FormData(form).get(name)));

export function AssetCorrectionForm({userId,assetId,revision,tanggal,harga}:{userId:string;assetId:string;revision:number;tanggal:string;harga:number}) {
  const [preview,setPreview]=useState<AssetCorrectionPreview|null>(null);
  const [busy,setBusy]=useState(false);
  const verified=useRef("");
  const version=useRef(0);
  const invalidate=()=>{version.current++;verified.current="";setPreview(null);};
  return <div className="crm-sec" onInputCapture={invalidate} onSubmitCapture={event=>{
    // Preserve the selected intent even when the browser/React omits the
    // submitter's name/value from the action FormData (notably recovery).
    const form=event.target as HTMLFormElement;
    const submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
    const intent=form.querySelector<HTMLInputElement>('input[name="tindakan"]');
    if(intent)intent.value=submitter?.value==="periksa"?"periksa":"simpan";
  }}>
    <h3>Koreksi pembelian aset</h3>
    <p>Betulkan kesalahan nominal atau tanggal dengan alasan tercatat. Jurnal asal tetap tersedia; sistem menambahkan pembalik dan pengganti. Umur ekonomis dan nilai sisa tetap.</p>
    <CorrectionTransactionForm userId={userId} scope={`asset-correct:${assetId}`} action={async data=>{
      if(data.get("tindakan")==="periksa")return koreksiPembelianAset(data);
      const proposed=JSON.stringify(["id","revision","tanggal","harga","alasan"].map(name=>data.get(name)));
      if(!preview?.allowed||verified.current!==proposed){invalidate();return;}
      await koreksiPembelianAset(data);
    }}>
      {({ready})=><>
        <input type="hidden" name="id" value={assetId}/>
        <input type="hidden" name="revision" value={revision}/>
        <input type="hidden" name="tindakan" defaultValue="simpan"/>
        <div className="fg"><label className="flab" htmlFor="asset-correct-date">Tanggal pembelian yang benar</label>
          <input className="fi" id="asset-correct-date" name="tanggal" type="date" defaultValue={tanggal} max={hariIniWIB()} required/></div>
        <div className="fg"><label className="flab" htmlFor="asset-correct-amount">Nominal pembelian yang benar (Rp)</label>
          <input className="fi" id="asset-correct-amount" name="harga" type="number" defaultValue={harga} min="0.01" max="1000000000000000" step="any" required/></div>
        <div className="fg"><label className="flab" htmlFor="asset-correct-reason">Alasan koreksi</label>
          <textarea className="fi" id="asset-correct-reason" name="alasan" minLength={3} maxLength={1000} required/></div>
        <button className="btn-def" type="button" data-preview disabled={!ready||busy} onClick={async event=>{
          const form=event.currentTarget.form!;const before=signature(form);const requestVersion=version.current;
          setBusy(true);verified.current="";setPreview(null);
          try{
            const result=await previewKoreksiAset(new FormData(form));
            if(before===signature(form)&&requestVersion===version.current){verified.current=before;setPreview(result);}
          }catch{setPreview({allowed:false,blockers:["Pratinjau belum terkonfirmasi. Coba lagi."]});}
          finally{setBusy(false);}
        }}>{busy?"Memeriksa…":"Lihat dampak koreksi"}</button>
        {preview&&<div role="status" style={{marginTop:12}}>
          {preview.blockers.map((problem,index)=><p key={index}>{problem}</p>)}
          {preview.allowed&&<>
            <p>Nilai aset dan nilai buku: {rp(preview.harga_before)} → {rp(preview.harga_after)}. Akumulasi penyusutan: Rp 0.</p>
            <p>Tanggal pembelian: {preview.tanggal_before} → {preview.tanggal_after}.</p>
            <p>Penyusutan bulanan: {rp(preview.monthly_before)} → {rp(preview.monthly_after)}; mengikuti aturan penyusutan yang berlaku.</p>
            <p>Jurnal pembalik {rp(preview.harga_before)} pada tanggal asal, lalu jurnal pengganti {rp(preview.harga_after)} pada tanggal baru. Rekening asal: {preview.cash_code}.</p>
          </>}
        </div>}
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <SubmitButton className="btn-acc" name="tindakan" value="simpan" disabled={!ready||busy||!preview?.allowed} style={!ready||busy||!preview?.allowed?{opacity:0.5,cursor:"not-allowed"}:undefined}>Simpan koreksi</SubmitButton>
          <button className="btn-def" name="tindakan" value="periksa" type="submit" formNoValidate disabled={!ready||busy}>Periksa hasil terakhir</button>
        </div>
      </>}
    </CorrectionTransactionForm>
  </div>;
}
