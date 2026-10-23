"use client";
import { useCallback,useEffect,useMemo,useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { createSalesRequestStore } from "@/lib/sales-request";
import { recoverProductionPosting } from "@/app/(app)/pos/produksi/actions";

/** Posting identity is independent of the local form-draft identity. */
export function ProductionRequestIdentity({userId,kind,orderId,mode="recipe"}:{userId:string;kind:"start"|"finish";orderId?:string;mode?:"recipe"|"adhoc"}) {
 const scope=kind==="start"?mode==="adhoc"?"production-start-adhoc":"production-start":`production-finish:${orderId}`;
 const store=useMemo(()=>createSalesRequestStore(`production:${userId}:${scope}`,()=>sessionStorage,()=>crypto.randomUUID()),[userId,scope]);
 const subscribe=useCallback((listener:()=>void)=>store.subscribe(listener),[store]);
 const {key,previous,unavailable}=useSyncExternalStore(subscribe,store.getSnapshot,store.getServerSnapshot);
 const params=useSearchParams(),confirmed=params.get("request_done"),confirmedScope=params.get("request_scope");
 useEffect(()=>{if(confirmedScope===scope&&confirmed)store.confirm(confirmed);},[scope,store,confirmed,confirmedScope]);
 return <>
  <input type="hidden" name="request_key" value={unavailable?"":key}/>
  <input type="hidden" name="request_scope" value={scope}/>
  <input type="hidden" name="production_kind" value={kind}/>
  <input type="hidden" name="production_mode" value={mode}/>
  {unavailable&&<p role="alert">Penyimpanan sesi tidak tersedia. Aktifkan lalu muat ulang sebelum memulai produksi; identitas retry belum aman.</p>}
  {previous&&<div className="p2ban">Periksa transaksi lama sebelum mengubah isian atau mencoba lagi. <button type="submit" formNoValidate formAction={recoverProductionPosting} className="btn-def">Periksa hasil produksi terakhir</button></div>}
 </>;
}
