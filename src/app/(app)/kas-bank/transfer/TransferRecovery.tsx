"use client";

import { useSyncExternalStore } from "react";
import { PreservedForm } from "@/components/LocalTransactionDraft";
import { SubmitButton } from "@/components/SubmitButton";
import { pulihkanTransfer } from "./actions";

/** Remains available after the original was voided, or drops out of the list. */
export function TransferRecovery({ userId }: { userId: string }) {
  const prefix = `vetos:correction-key:v1:${userId}:`;
  const read = () => {
    const pending: { scope: string; key: string }[] = [];
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const name = sessionStorage.key(index);
        if (!name?.startsWith(prefix)) continue;
        const scope = name.slice(prefix.length), key = sessionStorage.getItem(name);
        if (/^bank-transfer-(create|(?:edit|void)-[0-9a-f-]{36}-\d+)$/i.test(scope) && key && key.length <= 120) pending.push({ scope, key });
      }
    } catch { return "[]"; }
    return JSON.stringify(pending.sort((a, b) => a.scope.localeCompare(b.scope)));
  };
  const pending = JSON.parse(useSyncExternalStore(notify => {
    window.addEventListener("vetos:transaction-confirmed", notify);
    window.addEventListener("storage", notify);
    queueMicrotask(notify);
    return () => { window.removeEventListener("vetos:transaction-confirmed", notify); window.removeEventListener("storage", notify); };
  }, read, () => "[]")) as { scope: string; key: string }[];
  return <>{pending.map(p => <PreservedForm key={p.scope} action={pulihkanTransfer} style={{ marginBottom: 10 }}>
    <input type="hidden" name="draft_scope" value={p.scope}/><input type="hidden" name="draft_key" value={p.key}/>
    <SubmitButton className="btn-def" pendingText="Memeriksa…">Periksa hasil catatan transfer sebelumnya ({p.scope === "bank-transfer-create" ? "baru" : p.scope.includes("-edit-") ? "koreksi" : "pembatalan"})</SubmitButton>
  </PreservedForm>)}</>;
}
