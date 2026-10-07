"use client";
import { useState } from "react";
import { LocalTransactionDraft, PreservedForm } from "@/components/LocalTransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { voidAndReissue } from "./actions";
export function VoidReissueForm({visitId,invoiceId,requestKey}:{visitId:string;invoiceId:string;requestKey:string}) {
  const [key,setKey]=useState(requestKey);
  return <PreservedForm action={voidAndReissue} style={{display:"flex",gap:8,alignItems:"flex-end"}}>
    <LocalTransactionDraft scope={`clinic-reissue:${visitId}:${invoiceId}`} state={{snapshot:{key},restore:s=>{if(typeof s.key!=="string"||!s.key)return false;setKey(s.key);return true;},reset:()=>setKey(crypto.randomUUID())}}/>
    <input type="hidden" name="visitId" value={visitId}/><input type="hidden" name="invoiceId" value={invoiceId}/><input type="hidden" name="requestKey" value={key}/>
    <div style={{flex:1}}><label className="flab">Alasan void *</label><input className="fi" name="reason" required placeholder="mis. salah tagih jasa rawat inap"/></div>
    <SubmitButton className="btn-def" icon="ti-file-x" style={{color:"#b91c1c",borderColor:"#fca5a5"}} pendingText="Memproses…">Void &amp; Terbitkan Ulang</SubmitButton>
  </PreservedForm>;
}
