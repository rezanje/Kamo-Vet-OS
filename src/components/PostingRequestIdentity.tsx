"use client";
import { useMemo, useCallback, useSyncExternalStore, useEffect } from 'react';
import { TransactionDraft, clearTransactionDraft, type DraftSnapshot } from "./TransactionDraft";
import { createSalesRequestStore } from '@/lib/sales-request';
import { recoverUnitPosting } from '@/app/(app)/penjualan/online/actions';
/** SQL uses this stable identity to replay a committed request after a lost response. */
export function PostingRequestIdentity({scope,userId,state,confirmedScope,confirmedKey}:{scope:string;userId?:string;state?:DraftSnapshot;confirmedScope?:string;confirmedKey?:string}) {
 const store=useMemo(()=>createSalesRequestStore(`unit:${userId ?? "anonymous"}:${scope}`,()=>sessionStorage,()=>crypto.randomUUID()),[scope,userId]);
 const subscribe=useCallback((fn:()=>void)=>{
  const unsub=store.subscribe(fn);
  return unsub;
 },[store]);
 const {key,previous,unavailable}=useSyncExternalStore(subscribe,store.getSnapshot,store.getServerSnapshot);
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);const completed=confirmedKey ?? params.get('request_done')??'';
  if((confirmedScope ?? params.get('request_scope'))===scope && completed){
   if(userId) clearTransactionDraft(userId,'transaction',scope,completed);
   window.dispatchEvent(new CustomEvent('vetos:transaction-confirmed',{detail:{scope,key:completed}}));
   store.confirm(completed);
  }
 },[scope,store,userId,confirmedScope,confirmedKey]);
 return <>{userId&&<TransactionDraft userId={userId} domain="transaction" scope={scope} requestKey={key} state={state}/>}<input type="hidden" name="request_key" value={key}/><input type="hidden" name="request_scope" value={scope}/>
 {unavailable&&<div className="p2ban">Penyimpanan sesi browser tidak tersedia. Aktifkan lalu muat ulang sebelum menyimpan.</div>}
 {previous&&<button type="submit" className="btn-def" formNoValidate formAction={recoverUnitPosting}>Periksa hasil transaksi terakhir</button>}</>;
}
