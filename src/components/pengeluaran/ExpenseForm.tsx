"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { TransactionDraft, clearTransactionDraft } from "@/components/TransactionDraft";
import { usePreservedAction } from "@/components/LocalTransactionDraft";
import { periksaExpense } from "@/app/(app)/pos/expense/actions";

const Ready = createContext(false);

/** A financial request identity survives failed responses independently of draft expiry. */
export function ExpenseForm({ userId, scope, action, children }: {
  userId: string; scope: string; action: (data: FormData) => Promise<void>; children: ReactNode;
}) {
  const identity = `${userId}:${scope}`;
  const [stored, setStored] = useState({ identity: "", key: "" });
  const [storageFailure, setStorageFailure] = useState("");
  const key = stored.identity === identity ? stored.key : "";
  const inFlight = useRef(false);
  const { save, failure } = usePreservedAction(action);
  const recovery = usePreservedAction(periksaExpense);
  useEffect(() => {
    const name = `vetos:expense-request:v1:${identity}`;
    let requestKey = "";
    let durable = true;
    try { requestKey = sessionStorage.getItem(name) ?? ""; } catch { durable = false; }
    const confirmedParams = new URLSearchParams(window.location.search);
    if (requestKey && confirmedParams.get("draft_scope") === scope && confirmedParams.get("draft_done") === requestKey) {
      clearTransactionDraft(userId, "transaction", scope, requestKey);
      try { sessionStorage.removeItem(`vetos:expense-attempt:v1:${identity}`); } catch { durable = false; }
      requestKey = "";
    }
    if (!requestKey || requestKey.length > 120) requestKey = crypto.randomUUID();
    try { sessionStorage.setItem(name, requestKey); durable = durable && sessionStorage.getItem(name) === requestKey; } catch { durable = false; }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) {
      setStored({ identity, key: durable ? requestKey : "" });
      setStorageFailure(durable ? "" : "Penyimpanan browser tidak tersedia. Isian tetap terlihat; aktifkan penyimpanan lalu muat ulang sebelum menyimpan pengeluaran.");
    } });
    const confirmed = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; key: string }>).detail;
      if (detail?.scope !== scope || detail.key !== requestKey) return;
      requestKey = crypto.randomUUID();
      try {
        sessionStorage.removeItem(`vetos:expense-attempt:v1:${identity}`);
        sessionStorage.setItem(name, requestKey);
        if (sessionStorage.getItem(name) !== requestKey) throw Error("Storage unavailable");
        setStored({ identity, key: requestKey });
      } catch {
        setStored({ identity, key: "" });
        setStorageFailure("Penyimpanan browser tidak tersedia. Transaksi terkonfirmasi; aktifkan penyimpanan sebelum memulai pengeluaran berikutnya.");
      }
    };
    window.addEventListener("vetos:transaction-confirmed", confirmed);
    return () => { cancelled = true; window.removeEventListener("vetos:transaction-confirmed", confirmed); };
  }, [identity, scope, userId]);

  const submit = async (data: FormData) => {
    if (!key || inFlight.current) return;
    try { sessionStorage.setItem(`vetos:expense-attempt:v1:${identity}`, key); }
    catch {
      setStorageFailure("Penyimpanan browser tidak tersedia. Pengeluaran belum dikirim. Isian tetap tersedia.");
      setStored({ identity, key: "" });
      return;
    }
    inFlight.current = true;
    try { await save(data); } finally { inFlight.current = false; }
  };
  return <form key={identity} action={submit} onSubmitCapture={event => { if (!key || inFlight.current) event.preventDefault(); }}>
    <input type="hidden" name="request_key" value={key} />
    <input type="hidden" name="draft_key" value={key} />
    <input type="hidden" name="draft_scope" value={scope} />
    <TransactionDraft userId={userId} domain="transaction" scope={scope} requestKey={key} />
    {storageFailure && <div role="alert" className="p2ban">{storageFailure}</div>}
    {failure && <div role="alert" className="p2ban">{failure}</div>}
    {recovery.failure && <div role="alert" className="p2ban">{recovery.failure}</div>}
    <Ready.Provider value={!!key}>{children}
      <div style={{ marginTop: 10, fontSize: 11, color: "var(--tm)" }}>
        Respons simpan belum jelas? Periksa transaksi ini sebelum memulai pengeluaran berikutnya.
        <ExpenseSubmitButton className="btn-def" formNoValidate style={{ marginLeft: 8 }} formAction={async data => {
          if (!key || inFlight.current) return;
          inFlight.current = true;
          try { await recovery.save(data); } finally { inFlight.current = false; }
        }}>Periksa Hasil Simpan</ExpenseSubmitButton>
      </div>
    </Ready.Provider>
  </form>;
}

export function ExpenseSubmitButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const ready = useContext(Ready);
  return <button {...props} type="submit" disabled={props.disabled || pending || !ready} aria-busy={pending}>
    {pending ? "Menyimpan…" : children}
  </button>;
}

/** The cashier can confirm a lost response even after the originating shift closed. */
export function ExpensePendingRecovery({ userId, confirmedScope, confirmedKey }: { userId: string; confirmedScope?: string; confirmedKey?: string }) {
  const [pending, setPending] = useState<{ scope: string; key: string }[]>([]);
  useEffect(() => {
    const prefix = `vetos:expense-attempt:v1:${userId}:`;
    if (confirmedScope && confirmedKey) {
      clearTransactionDraft(userId, "transaction", confirmedScope, confirmedKey);
      try {
        if (sessionStorage.getItem(`${prefix}${confirmedScope}`) === confirmedKey) sessionStorage.removeItem(`${prefix}${confirmedScope}`);
        const name = `vetos:expense-request:v1:${userId}:${confirmedScope}`;
        if (sessionStorage.getItem(name) === confirmedKey) sessionStorage.removeItem(name);
      } catch { /* A confirmation is still valid if storage is unavailable. */ }
    }
    const rows: { scope: string; key: string }[] = [];
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const name = sessionStorage.key(index);
        if (!name?.startsWith(`${prefix}cashier-expense:`)) continue;
        const scope = name.slice(prefix.length), key = sessionStorage.getItem(name) ?? "";
        if (key && key.length <= 120 && scope.length <= 200) rows.push({ scope, key });
      }
    } catch { /* Starting a shift remains available. */ }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setPending(rows); });
    return () => { cancelled = true; };
  }, [userId, confirmedScope, confirmedKey]);
  return <>{pending.map(row => <PendingExpense key={row.scope} scope={row.scope} requestKey={row.key} />)}</>;
}

function PendingExpense({ scope, requestKey }: { scope: string; requestKey: string }) {
  const { save, failure } = usePreservedAction(periksaExpense);
  return <form action={save} className="card" style={{ padding: 14, margin: "12px 0" }}>
    <input type="hidden" name="request_key" value={requestKey} /><input type="hidden" name="draft_key" value={requestKey} /><input type="hidden" name="draft_scope" value={scope} />
    <p style={{ fontSize: 12 }}>Periksa pengeluaran yang respons simpannya belum terkonfirmasi dari shift {scope.slice("cashier-expense:".length, "cashier-expense:".length + 8)}.</p>
    {failure && <div role="alert" className="p2ban">{failure}</div>}
    <Ready.Provider value={true}><ExpenseSubmitButton className="btn-def">Periksa Hasil Simpan</ExpenseSubmitButton></Ready.Provider>
  </form>;
}
