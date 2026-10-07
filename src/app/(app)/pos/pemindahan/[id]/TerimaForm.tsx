"use client";

import { LocalTransactionDraft, usePreservedAction } from "@/components/LocalTransactionDraft";
import { useState } from "react";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { terimaBarang } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

type Row = { item_id: string; name: string; code: string; unit: string; sisa: number };

export function TerimaForm({ sourceTransferId, rows, userId }: { sourceTransferId: string; rows: Row[]; userId: string }) {
  const { save, failure } = usePreservedAction(terimaBarang);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  // default: terima semua sisa
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.item_id, r.sisa])),
  );

  const payload = rows
    .map((r) => ({ item_id: r.item_id, qty: Number(qty[r.item_id]) || 0 }))
    .filter((r) => r.qty > 0);

  return (
    <form action={save}>
      <LocalTransactionDraft userId={userId} scope={`pos:pemindahan:terima:${sourceTransferId}`} state={{ snapshot: { qty, requestKey }, reset: () => { setQty({}); setRequestKey(crypto.randomUUID()); }, restore: value => { const draft = value as { qty?: Record<string, number>; requestKey?: string }; if (draft.qty) setQty(draft.qty); if (draft.requestKey) setRequestKey(draft.requestKey); return true; } }} />
      <input type="hidden" name="request_key" value={requestKey} />
      {failure && <div role="alert" className="p2ban">{failure}</div>}
      <input type="hidden" name="source_transfer_id" value={sourceTransferId} />
      <input type="hidden" name="items" value={JSON.stringify(payload)} />

      <div className="crm-sec">
        <SecHeader num="03" title="TERIMA BARANG" desc="Konfirmasi barang sampai di gudang tujuan. Qty dalam satuan dasar; bisa dikurangi bila diterima sebagian." />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(160px, 220px))", gap: 10, marginBottom: 10 }}>
          <div className="fg">
            <label className="flab">Tanggal terima *</label>
            <input className="fi" type="date" name="tanggal" defaultValue={hariIniWIB()} required />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ flex: 1, fontSize: 11.5 }}>
                {r.name} <span style={{ color: "var(--td)", fontSize: 10.5 }}>({r.code})</span>
              </span>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>sisa {r.sisa}</span>
              <input className="fi" type="number" min={0} max={r.sisa} step="any"
                value={qty[r.item_id] ?? 0}
                onChange={(e) => setQty((q) => ({ ...q, [r.item_id]: Number(e.target.value) }))}
                style={{ width: 90 }} title="Qty diterima" />
              <span style={{ fontSize: 10.5, color: "var(--tm)", width: 34 }}>{r.unit}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <SubmitButton className="btn-acc" disabled={payload.length === 0} icon="ti-package-import" pendingText="Menyimpan penerimaan…">
            Terima barang
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
