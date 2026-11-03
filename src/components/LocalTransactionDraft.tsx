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
  useEffect(()=>{if(!scope||!key)return;
    try { const name=`vetos:correction-key:v1:${userId}:${scope}`;if(sessionStorage.getItem(name)===key)sessionStorage.removeItem(name); } catch { /* Acknowledged server result remains authoritative. */ }
    clearTransactionDraft(userId,"transaction",scope,key);
    window.dispatchEvent(new CustomEvent("vetos:transaction-confirmed",{detail:{scope,key}}));},[userId,scope,key]);
  return null;
}
/** A server action may RETURN a deterministic refusal (nothing was written). `rejected` = fix/reload first,
 * `retry` = safe to repeat unchanged shortly. Thrown/returned-nothing results stay UNCONFIRMED (masked in production). */
export type ActionRejection={ok:false;outcome:"rejected"|"retry";message:string};
const isRejection=(value:unknown):value is ActionRejection=>typeof value==="object"&&value!==null
  &&(value as ActionRejection).ok===false&&["rejected","retry"].includes((value as ActionRejection).outcome)
  &&typeof (value as ActionRejection).message==="string"&&(value as ActionRejection).message.length>0;
/** Keep the page and draft on transport failure; require a human to verify uncertain commit. */
export function usePreservedAction(action:(data:FormData)=>void|ActionRejection|Promise<void|ActionRejection>,options?:{uncertain?:string}) {
  const [failure,setFailure]=useState("");
  const [outcome,setOutcome]=useState<ActionRejection["outcome"]|"">("");
  const save=async(data:FormData)=>{setFailure("");setOutcome("");let detail="";try{
    const result=await action(data);
    if(isRejection(result)){setFailure(result.message);setOutcome(result.outcome);return;}
  }catch(error){
    if(typeof error==="object"&&error!==null&&"digest" in error&&String(error.digest).startsWith("NEXT_REDIRECT"))throw error;
    detail = error instanceof Error && error.message ? ` ${error.message}` : "";
  }
    // These actions confirm completion by redirecting; a plain return is uncertain.
    setFailure(options?.uncertain??`Respons simpan belum terkonfirmasi.${detail} Isian tetap tersedia. Periksa daftar transaksi sebelum menyimpan ulang agar tidak menggandakan transaksi.`);
  };
  return {save,failure,outcome};
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
