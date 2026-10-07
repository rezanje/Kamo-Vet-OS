"use client";
import { TransactionDraft, clearTransactionDraft } from "./TransactionDraft";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { recoverSalesSubmission } from "@/app/(app)/penjualan/pesanan/actions";
import { createSalesRequestStore, salesStorageName } from "@/lib/sales-request";
const confirmedEvent = "vetos:sales-confirmed";

export function SalesRequestIdentity({ scope, recoveryOnly = false, userId }: { scope: string; recoveryOnly?: boolean; userId?: string }) {
  const store = useMemo(() => createSalesRequestStore(scope, () => sessionStorage, () => crypto.randomUUID(), recoveryOnly), [scope, recoveryOnly]);
  const subscribe = useCallback((listener: () => void) => {
    const unsubscribe = store.subscribe(listener);
    const onConfirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; key: string }>).detail;
      if (detail.scope === scope) store.confirm(detail.key);
    };
    window.addEventListener(confirmedEvent, onConfirmed);
    return () => { unsubscribe(); window.removeEventListener(confirmedEvent, onConfirmed); };
  }, [scope, store]);
  const { key, previous, unavailable } = useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot);
  return <>
    <input type="hidden" name="request_key" value={key} />
    {userId && !recoveryOnly && <TransactionDraft userId={userId} domain="sales" scope={scope} requestKey={key} />}
    <input type="hidden" name="request_scope" value={scope} />
    {unavailable && <div className="p2ban">Penyimpanan sesi browser tidak tersedia. Aktifkan lalu muat ulang sebelum menyimpan.</div>}
    {previous && <div className="p2ban" style={{ marginBottom: 12 }}>
      Pernah menyimpan dari formulir ini? <button type="submit" formNoValidate
        formAction={recoverSalesSubmission} className="btn-def">Periksa hasil transaksi terakhir</button>
    </div>}
  </>;
}

export function SalesRecoveryComplete({ scope, requestKey, userId }: { scope?: string; requestKey?: string; userId?: string }) {
  useEffect(() => {
    if (!scope || !requestKey) return;
    if (userId) clearTransactionDraft(userId, "sales", scope, requestKey);
    try {
      const name = salesStorageName(scope);
      if (sessionStorage.getItem(name) === requestKey) sessionStorage.removeItem(name);
    } catch { /* Server confirmation still remains visible. */ }
    window.dispatchEvent(new CustomEvent(confirmedEvent, { detail: { scope, key: requestKey } }));
  }, [scope, requestKey, userId]);
  return null;
}

/** Keep recovery reachable when a committed shipment/invoice exhausts its form. */
export function SalesOrderRecovery({ orderId, kind }: { orderId: string; kind: "delivery" | "invoice" }) {
  return <form action={recoverSalesSubmission}>
    <input type="hidden" name="id" value={orderId} />
    <SalesRequestIdentity scope={`${kind}:${orderId}`} recoveryOnly />
  </form>;
}
