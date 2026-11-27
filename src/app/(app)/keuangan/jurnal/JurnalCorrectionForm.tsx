"use client";

import { NumberInput } from "@/components/NumberInput";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { draftRows } from "@/components/TransactionDraft";
import { SearchableItemPicker } from "@/components/SearchableItemPicker";
import { PosDecimal, formatPosMoney } from "@/lib/pos-money";
import { batalkanJurnal, koreksiJurnal } from "./actions";

type Account = { id: string; code: string; name: string };
type Line = { account_id: string; debit: number; credit: number };
type Cabang = { id: string; name: string };

// Akun diberi sisa lebar; debit/kredit cukup untuk belasan digit berpemisah ribuan.
const KOLOM_BARIS = "minmax(0, 1fr) minmax(110px, 170px) minmax(110px, 170px)";

/** Isi panel koreksi jurnal manual. Dibuka selebar tabel riwayat lewat JurnalKoreksiPanel
 *  (permintaan klinik 27 Nov 2026: di kolom Tindakan kolom akunnya tinggal beberapa huruf). */
export function JurnalCorrectionForm({ entryId, revision, tanggal: initialDate, deskripsi: initialDescription, lines: initialLines, accounts, userId, branchId: initialBranch = null, branches = [] }: {
  entryId: string; revision: number; tanggal: string; deskripsi: string; lines: Line[]; accounts: Account[]; userId: string;
  branchId?: string | null; branches?: Cabang[];
}) {
  const [tanggal, setTanggal] = useState(initialDate);
  const [deskripsi, setDeskripsi] = useState(initialDescription);
  const [lines, setLines] = useState(initialLines.map((line) => ({ ...line })));
  const [branchId, setBranchId] = useState(initialBranch ?? "");
  const [reason, setReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const serialized = JSON.stringify(lines);
  const totalDebit = lines.reduce((sum, line) => sum.plus(line.debit), new PosDecimal(0));
  const totalCredit = lines.reduce((sum, line) => sum.plus(line.credit), new PosDecimal(0));
  const balanced = lines.length >= 2 && totalDebit.gt(0) && totalDebit.equals(totalCredit);
  const setLine = (index: number, patch: Partial<Line>) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const editScope = `journal-edit-${entryId}-${revision}`;
  const voidScope = `journal-void-${entryId}-${revision}`;

  return <div style={{ display: "grid", gap: 14 }}>
    <CorrectionTransactionForm userId={userId} scope={editScope} action={koreksiJurnal} state={{ snapshot: { tanggal, deskripsi, branchId, lines, reason }, restore(value) {
      if (typeof value.tanggal !== "string" || typeof value.deskripsi !== "string" || typeof value.reason !== "string" || !draftRows(value.lines, { account_id: "", debit: 0, credit: 0 })) return false;
      if (typeof value.branchId === "string") setBranchId(value.branchId);
      setTanggal(value.tanggal); setDeskripsi(value.deskripsi); setReason(value.reason); setLines(value.lines); return true;
    }, reset() {} }}>
      {({ ready }) => <div style={{ display: "grid", gap: 10 }}>
        <input type="hidden" name="entryId" value={entryId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="lines" value={serialized} /><input type="hidden" name="branchAsal" value={initialBranch ?? ""} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <label className="flab" style={{ flex: "0 0 160px", marginBottom: 0 }}>Tanggal
            <input aria-label="Tanggal koreksi" className="fi" type="date" name="tanggal" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required />
          </label>
          <label className="flab" style={{ flex: "1 1 260px", minWidth: 0, marginBottom: 0 }}>Deskripsi
            <input aria-label="Deskripsi koreksi" className="fi" name="deskripsi" value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} required />
          </label>
          <label className="flab" style={{ flex: "0 1 260px", minWidth: 180, marginBottom: 0 }}>Cabang
            <select aria-label="Cabang koreksi" className="fi" name="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">— Pusat / tanpa cabang —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="flab" aria-hidden="true" style={{ display: "grid", gridTemplateColumns: KOLOM_BARIS, gap: 8, marginBottom: 0 }}>
            <span>Akun</span><span style={{ textAlign: "right" }}>Debit (Rp)</span><span style={{ textAlign: "right" }}>Kredit (Rp)</span>
          </div>
          {lines.map((line, index) => <div key={index} style={{ display: "grid", gridTemplateColumns: KOLOM_BARIS, gap: 8, alignItems: "start" }}>
            <SearchableItemPicker items={accounts} value={line.account_id} onChange={(id) => setLine(index, { account_id: id })} ariaLabel={`Akun baris ${index + 1}`} placeholder="Ketik kode / nama akun" selectedLabelFormat="code-name" detailLabel="Kode" requiredMessage="Pilih akun dari daftar hasil cari." />
            <NumberInput aria-label={`Debit baris ${index + 1}`} className="fi" type="number" min="0" step="0.01" placeholder="0" style={{ textAlign: "right" }} value={line.debit || ""} onChange={(e) => setLine(index, { debit: Number(e.target.value) || 0, credit: 0 })} />
            <NumberInput aria-label={`Kredit baris ${index + 1}`} className="fi" type="number" min="0" step="0.01" placeholder="0" style={{ textAlign: "right" }} value={line.credit || ""} onChange={(e) => setLine(index, { credit: Number(e.target.value) || 0, debit: 0 })} />
          </div>)}
          <div data-testid="koreksi-total" style={{ display: "grid", gridTemplateColumns: KOLOM_BARIS, gap: 8, fontSize: 12, fontWeight: 600, paddingTop: 6, borderTop: ".5px solid var(--bd)" }}>
            <span style={{ color: balanced ? "#15803d" : "#b91c1c" }}>{balanced ? "Total — balance" : "Total — belum balance, debit dan kredit harus sama"}</span>
            <span style={{ textAlign: "right", color: "#2563eb", paddingRight: 9 }}>{formatPosMoney(totalDebit.toNumber())}</span>
            <span style={{ textAlign: "right", color: "#16a34a", paddingRight: 9 }}>{formatPosMoney(totalCredit.toNumber())}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="flab" style={{ flex: "1 1 280px", minWidth: 0, marginBottom: 0 }}>Alasan koreksi
            <input aria-label="Alasan koreksi" className="fi" name="reason" placeholder="Alasan koreksi (wajib)" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </label>
          <SubmitButton className="btn-acc" pendingText="Menyimpan…" disabled={!ready || !balanced || reason.trim().length < 3}>Simpan koreksi</SubmitButton>
        </div>
      </div>}
    </CorrectionTransactionForm>
    <CorrectionTransactionForm userId={userId} scope={voidScope} action={batalkanJurnal} style={{ borderTop: ".5px dashed var(--bd)", paddingTop: 12 }} state={{ snapshot: { reason: voidReason }, restore(value) { if (typeof value.reason !== "string") return false; setVoidReason(value.reason); return true; }, reset() {} }}>
      {({ ready }) => <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <input type="hidden" name="entryId" value={entryId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="action" value="void" />
        <label className="flab" style={{ flex: "1 1 280px", minWidth: 0, marginBottom: 0 }}>Atau batalkan jurnal ini
          <input aria-label="Alasan pembatalan" className="fi" name="reason" placeholder="Alasan pembatalan (wajib)" minLength={3} required value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
        </label>
        <SubmitButton className="btn-def" pendingText="Membatalkan…" disabled={!ready || voidReason.trim().length < 3} style={{ color: "#b91c1c" }}>Batalkan jurnal</SubmitButton>
      </div>}
    </CorrectionTransactionForm>
  </div>;
}
