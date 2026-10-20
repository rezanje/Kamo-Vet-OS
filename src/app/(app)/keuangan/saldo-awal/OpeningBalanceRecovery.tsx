"use client";
import {useEffect,useSyncExternalStore} from "react";
import {useSearchParams} from "next/navigation";
import {PreservedForm} from "@/components/LocalTransactionDraft";
import {clearTransactionDraft} from "@/components/TransactionDraft";
import {SubmitButton} from "@/components/SubmitButton";
import {pulihkanSaldoAwal} from "./actions";

export function OpeningBalanceRecovery({userId}:{userId:string}) {
 const prefix=`vetos:correction-key:v1:${userId}:`;
 const read=()=>{
  const pending:{scope:string;key:string}[]=[];
  try{for(let i=0;i<sessionStorage.length;i++){
   const name=sessionStorage.key(i);if(!name?.startsWith(prefix))continue;
   const scope=name.slice(prefix.length),key=sessionStorage.getItem(name);
   if((scope==="opening-balance-create"||scope.startsWith("opening-balance-void-"))&&key&&key.length<=120)pending.push({scope,key});
  }}catch{return "[]";}
  return JSON.stringify(pending.sort((a,b)=>a.scope.localeCompare(b.scope)));
 };
 const pending=JSON.parse(useSyncExternalStore(notify=>{
  window.addEventListener("vetos:transaction-confirmed",notify);window.addEventListener("vetos:opening-recovered",notify);window.addEventListener("storage",notify);
  queueMicrotask(notify);
  return()=>{window.removeEventListener("vetos:transaction-confirmed",notify);window.removeEventListener("vetos:opening-recovered",notify);window.removeEventListener("storage",notify);};
 },read,()=>"[]")) as {scope:string;key:string}[];
 const params=useSearchParams();
 useEffect(()=>{
  const scope=params.get("draft_scope"),key=params.get("draft_done");
  if(!scope||!key||!(scope==="opening-balance-create"||scope.startsWith("opening-balance-void-")))return;
  try{if(sessionStorage.getItem(prefix+scope)===key)sessionStorage.removeItem(prefix+scope);}catch{/* Confirmation remains authoritative. */}
  clearTransactionDraft(userId,"transaction",scope,key);window.dispatchEvent(new Event("vetos:opening-recovered"));
 },[params,prefix,userId]);
 return <>{pending.map(p=><PreservedForm key={p.scope} action={pulihkanSaldoAwal} style={{marginTop:10}}>
  <input type="hidden" name="draft_key" value={p.key}/><input type="hidden" name="draft_scope" value={p.scope}/>
  <SubmitButton className="btn-def" pendingText="Memeriksa…">Periksa hasil {p.scope.includes("-void-")?"pembatalan":"penyimpanan"} sebelumnya</SubmitButton>
 </PreservedForm>)}</>;
}
