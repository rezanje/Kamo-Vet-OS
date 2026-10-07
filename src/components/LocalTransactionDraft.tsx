"use client";
import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {useSearchParams} from "next/navigation";
import {TransactionDraft,clearTransactionDraft,transactionDraftName,type DraftSnapshot} from "./TransactionDraft";

const DraftUserContext = createContext("");
export function DraftUserProvider({userId,children}:{userId:string;children:ReactNode}) {
  return <DraftUserContext.Provider value={userId}>{children}</DraftUserContext.Provider>;
}
export function useDraftUserId(explicit?: string) { const userId = useContext(DraftUserContext); return explicit ?? userId; }

/** Per-user, per-tab draft identity. Never used as a posting or replay key. */
export function LocalTransactionDraft({userId: explicitUserId,scope,state}:{userId?:string;scope:string;state?:DraftSnapshot}) {
  const userId = useDraftUserId(explicitUserId);
  const identity = `${userId}:${scope}`;
  const [stored,setStored]=useState({identity: "", key: ""});
  const key = stored.identity === identity ? stored.key : "";
  useEffect(()=>{
    let savedKey="";
    try {const saved=JSON.parse(sessionStorage.getItem(transactionDraftName(userId,"transaction",scope))??"null");
      if(saved?.version===1 && typeof saved.requestKey==="string" && saved.requestKey.length<=120) savedKey=saved.requestKey;
    } catch { /* TransactionDraft provides the storage warning. */ }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setStored({identity,key:savedKey||crypto.randomUUID()}); });
    const confirm=(event:Event)=>{const detail=(event as CustomEvent<{scope:string;key:string}>).detail;
      if(detail?.scope===scope) setStored(current=>current.identity===identity&&current.key===detail.key?{identity,key:crypto.randomUUID()}:current);};
    window.addEventListener("vetos:transaction-confirmed",confirm);
    return ()=>{cancelled=true;window.removeEventListener("vetos:transaction-confirmed",confirm);};
  },[userId,scope,identity]);
  return <><input type="hidden" name="draft_key" value={key}/><input type="hidden" name="draft_scope" value={scope}/>
    <TransactionDraft userId={userId} domain="transaction" scope={scope} requestKey={key} state={state}/></>;
}
export function TransactionDraftComplete({userId}:{userId:string}) {
  const params=useSearchParams();const scope=params.get("draft_scope"),key=params.get("draft_done");
  useEffect(()=>{if(!scope||!key)return;clearTransactionDraft(userId,"transaction",scope,key);
    window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope,key}}));},[userId,scope,key]);
  return null;
}
/** Keep the page and draft on transport failure; require a human to verify uncertain commit. */
export function usePreservedAction(action:(data:FormData)=>void|Promise<void>) {
  const [failure,setFailure]=useState("");
  const save=async(data:FormData)=>{setFailure("");try{await action(data);}catch(error){
    if(typeof error==="object"&&error!==null&&"digest" in error&&String(error.digest).startsWith("NEXT_REDIRECT"))throw error;
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    setFailure(`Respons simpan belum terkonfirmasi.${detail} Isian tetap tersedia. Periksa daftar transaksi sebelum menyimpan ulang agar tidak menggandakan transaksi.`);
  }};
  return {save,failure};
}
export function TransactionForm({userId: explicitUserId,scope,action,children,...props}:{userId?:string;scope:string;action:(data:FormData)=>void|Promise<void>;children:ReactNode}&Omit<React.FormHTMLAttributes<HTMLFormElement>,"action">) {
  const userId = useDraftUserId(explicitUserId);
  const {save,failure}=usePreservedAction(action);
  return <form key={`${userId}:${scope}`} {...props} action={save}><LocalTransactionDraft userId={userId} scope={scope}/>{failure&&<div role="alert" className="p2ban">{failure}</div>}{children}</form>;
}

export function PreservedForm({action,children,...props}:{action:(data:FormData)=>void|Promise<void>;children:ReactNode}&Omit<React.FormHTMLAttributes<HTMLFormElement>,"action">) {
  const {save,failure}=usePreservedAction(action);
  return <form {...props} action={save}>{failure&&<div role="alert" className="p2ban">{failure}</div>}{children}</form>;
}
