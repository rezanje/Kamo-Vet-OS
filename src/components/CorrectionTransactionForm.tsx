"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { usePreservedAction } from "./LocalTransactionDraft";
import { TransactionDraft, clearTransactionDraft, type DraftSnapshot } from "./TransactionDraft";

const ERROR = "__storage_error__";
const storageFailures = new Set<string>();
const uuid = () => crypto.randomUUID();
const storageName = (userId: string, scope: string) => `vetos:correction-key:v1:${userId}:${scope}`;

function useDurableKey(userId: string, scope: string) {
  const name = storageName(userId, scope);
  const read = () => {
    if (storageFailures.has(name)) return ERROR;
    try {
      const value = sessionStorage.getItem(name) ?? "";
      return value.length > 120 ? ERROR : value;
    } catch { return ERROR; }
  };
  const key = useSyncExternalStore((notify) => {
    try {
      if (!sessionStorage.getItem(name)) sessionStorage.setItem(name, uuid());
    } catch { storageFailures.add(name); /* getSnapshot reports the storage failure and keeps submit disabled. */ }
    queueMicrotask(notify);
    return () => {};
  }, read, () => "");
  return { key: key === ERROR ? "" : key, storageError: key === ERROR, name };
}

export function CorrectionTransactionForm({ userId, scope, action, state, children, className, style }: {
  userId: string;
  scope: string;
  action: (formData: FormData) => void | Promise<void>;
  state?: DraftSnapshot;
  children: (status: { ready: boolean; storageError: boolean }) => ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { key, storageError, name } = useDurableKey(userId, scope);
  const { save, failure } = usePreservedAction(action);
  const params = useSearchParams();
  const ready = !!userId && !!key && !storageError;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!ready || params.get("draft_scope") !== scope || params.get("draft_done") !== key) return;
    try { sessionStorage.removeItem(name); } catch { /* successful posting remains authoritative. */ }
    clearTransactionDraft(userId, "transaction", scope, key);
  }, [key, name, params, ready, scope, userId]);

  return (
    <form action={async data => {
      if (!ready || inFlight.current) return;
      inFlight.current = true;
      try { await save(data); } finally { inFlight.current = false; }
    }} onSubmitCapture={event => { if (!ready || inFlight.current) event.preventDefault(); }} className={className} style={style}>
      <input type="hidden" name="draft_key" value={key} />
      <input type="hidden" name="draft_scope" value={scope} />
      <input type="hidden" name="requestKey" value={key} />
      <TransactionDraft userId={userId} domain="transaction" scope={scope} requestKey={key} state={state} />
      {storageError && <div role="alert" className="p2ban">Penyimpanan browser tidak tersedia. Muat ulang sebelum mengoreksi transaksi.</div>}
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      {children({ ready, storageError })}
    </form>
  );
}
