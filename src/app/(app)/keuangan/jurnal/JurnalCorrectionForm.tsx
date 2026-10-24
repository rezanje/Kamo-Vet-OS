"use client";

import { NumberInput } from "@/components/NumberInput";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { draftRows } from "@/components/TransactionDraft";
import { PosDecimal } from "@/lib/pos-money";
import { batalkanJurnal, koreksiJurnal } from "./actions";

type Account = { id: string; code: string; name: string };
type Line = { account_id: string; debit: number; credit: number };

export function JurnalCorrectionForm({ entryId, revision, tanggal: initialDate, deskripsi: initialDescription, lines: initialLines, accounts, userId }: {
  entryId: string; revision: number; tanggal: string; deskripsi: string; lines: Line[]; accounts: Account[]; userId: string;
}) {
  const [tanggal, setTanggal] = useState(initialDate);
  const [deskripsi, setDeskripsi] = useState(initialDescription);
  const [lines, setLines] = useState(initialLines.map((line) => ({ ...line })));
  const [reason, setReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const serialized = JSON.stringify(lines);
  const totalDebit = lines.reduce((sum, line) => sum.plus(line.debit), new PosDecimal(0));
  const totalCredit = lines.reduce((sum, line) => sum.plus(line.credit), new PosDecimal(0));
  const balanced = lines.length >= 2 && totalDebit.gt(0) && totalDebit.equals(totalCredit);
  const setLine = (index: number, patch: Partial<Line>) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const editScope = `journal-edit-${entryId}-${revision}`;
  const voidScope = `journal-void-${entryId}-${revision}`;

  return <details style={{ marginTop: 8 }}>
    <summary style={{ cursor: "pointer", color: "#2563eb", fontSize: 10.5 }}>Edit jurnal manual</summary>
    <CorrectionTransactionForm userId={userId} scope={editScope} action={koreksiJurnal} state={{ snapshot: { tanggal, deskripsi, lines, reason }, restore(value) {
      if (typeof value.tanggal !== "string" || typeof value.deskripsi !== "string" || typeof value.reason !== "string" || !draftRows(value.lines, { account_id: "", debit: 0, credit: 0 })) return false;
      setTanggal(value.tanggal); setDeskripsi(value.deskripsi); setReason(value.reason); setLines(value.lines); return true;
    }, reset() {} }}>
      {({ ready }) => <div style={{ display: "grid", gap: 6, marginTop: 7 }}>
        <input type="hidden" name="entryId" value={entryId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="lines" value={serialized} />
        <input aria-label="Tanggal koreksi" className="fi" type="date" name="tanggal" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
        <input aria-label="Deskripsi koreksi" className="fi" name="deskripsi" value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} required />
        {lines.map((line, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 100px 100px", gap: 5 }}>
          <select aria-label={`Akun baris ${index + 1}`} className="fi" value={line.account_id} onChange={(e) => setLine(index, { account_id: e.target.value })}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}</select>
          <NumberInput aria-label={`Debit baris ${index + 1}`} className="fi" type="number" min="0" step="0.01" value={line.debit || ""} onChange={(e) => setLine(index, { debit: Number(e.target.value) || 0, credit: 0 })} />
          <NumberInput aria-label={`Kredit baris ${index + 1}`} className="fi" type="number" min="0" step="0.01" value={line.credit || ""} onChange={(e) => setLine(index, { credit: Number(e.target.value) || 0, debit: 0 })} />
        </div>)}
        <input aria-label="Alasan koreksi" className="fi" name="reason" placeholder="Alasan koreksi (wajib)" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        <SubmitButton className="btn-def" disabled={!ready || !balanced || reason.trim().length < 3}>Simpan koreksi</SubmitButton>
      </div>}
    </CorrectionTransactionForm>
    <CorrectionTransactionForm userId={userId} scope={voidScope} action={batalkanJurnal} state={{ snapshot: { reason: voidReason }, restore(value) { if (typeof value.reason !== "string") return false; setVoidReason(value.reason); return true; }, reset() {} }}>
      {({ ready }) => <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <input type="hidden" name="entryId" value={entryId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="action" value="void" />
        <input aria-label="Alasan pembatalan" className="fi" name="reason" placeholder="Alasan pembatalan (wajib)" minLength={3} required value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
        <SubmitButton className="btn-def" disabled={!ready || voidReason.trim().length < 3} style={{ color: "#b91c1c" }}>Batalkan</SubmitButton>
      </div>}
    </CorrectionTransactionForm>
  </details>;
}
