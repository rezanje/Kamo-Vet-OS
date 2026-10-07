"use client";

import { TransactionDraft, clearTransactionDraft, type DraftSnapshot } from "./TransactionDraft";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { recoverPurchaseSubmission } from "@/app/(app)/pembelian/actions";
import { createPurchaseRequestStore, purchaseStorageName } from "@/lib/purchase-request";

const confirmedEvent = "vetos:purchase-confirmed";

/** Retain only a submission identity across refresh or an uncertain response. */
export function PurchaseRequestKey({ scope, userId, draft }: { scope: string; userId?: string; draft?: DraftSnapshot }) {
  const store = useMemo(() => createPurchaseRequestStore(scope, () => sessionStorage, () => crypto.randomUUID()), [scope]);
  const subscribe = useCallback((listener: () => void) => {
    const unsubscribe = store.subscribe(listener);
    const onConfirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; key: string }>).detail;
      if (detail.scope === scope) store.confirm(detail.key);
    };
    window.addEventListener(confirmedEvent, onConfirmed);
    // Same-page navigation may keep the form mounted; retire exactly the confirmed key.
    const params = new URLSearchParams(window.location.search);
    if (params.get("request_scope") === scope) store.confirm(params.get("request_done") ?? "");
    return () => { unsubscribe(); window.removeEventListener(confirmedEvent, onConfirmed); };
  }, [scope, store]);
  const { key, previous } = useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot);
  return <>
    <input type="hidden" name="request_key" value={key} />
    {userId && <TransactionDraft userId={userId} domain="purchase" scope={scope} requestKey={key} state={draft} />}
    <input type="hidden" name="request_scope" value={scope} />
    {previous && <div className="p2ban" style={{ marginBottom: 12 }}>
      Pernah menyimpan dari formulir ini? <button type="submit" formNoValidate
        formAction={recoverPurchaseSubmission} className="btn-def">Periksa hasil transaksi terakhir</button>
    </div>}
  </>;
}

/** Clear only the request explicitly confirmed by the server's success redirect. */
export function PurchaseRecoveryComplete({ scope, requestKey, userId }: { scope?: string; requestKey?: string; userId?: string }) {
  useEffect(() => {
    if (!scope || !requestKey) return;
    if (userId) clearTransactionDraft(userId, "purchase", scope, requestKey);
    try {
      const name = purchaseStorageName(scope);
      if (sessionStorage.getItem(name) === requestKey) sessionStorage.removeItem(name);
    } catch { /* Confirmation remains visible even when storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(confirmedEvent, { detail: { scope, key: requestKey } }));
  }, [scope, requestKey, userId]);
  return null;
}

export function PurchaseReceiptRecovery({ poId }: { poId: string }) {
  return <form action={recoverPurchaseSubmission}>
    <PurchaseRequestKey scope={`receipt:${poId}`} />
  </form>;
}
