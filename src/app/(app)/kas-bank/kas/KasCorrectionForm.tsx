"use client";

import { NumberInput } from "@/components/NumberInput";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { koreksiKasEntry, batalkanKasEntry } from "./actions";

type Rek = { id: string; nama: string; coa_code: string };
type Coa = { code: string; name: string };

export function KasVoidForm({ userId, jenis, id, revision }: { userId: string; jenis: "Masuk" | "Keluar"; id: string; revision: number }) {
  const [reason, setReason] = useState("");
  return <CorrectionTransactionForm userId={userId} scope={`cash-void-${id}-${revision}`} action={batalkanKasEntry} state={{ snapshot: { reason }, restore(value) { if (typeof value.reason !== "string") return false; setReason(value.reason); return true; }, reset() {} }}>
    {({ ready }) => <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="jenis" value={jenis} /><input type="hidden" name="revision" value={revision} />
      <label className="flab">Alasan pembatalan<input className="fi" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wajib diisi" minLength={3} required /></label>
      <SubmitButton className="btn-def" disabled={!ready || reason.trim().length < 3} pendingText="Membatalkan…" style={{ color: "#b91c1c" }}>Batalkan</SubmitButton>
    </div>}
  </CorrectionTransactionForm>;
}

export function KasCorrectionForm({ userId, jenis, id, revision, tanggal: initialDate, accountId: initialAccount, lawanCode: initialLawan, jumlah: initialAmount, keterangan: initialNote, rekening, coa }: {
  userId: string; jenis: "Masuk" | "Keluar"; id: string; revision: number; tanggal: string; accountId: string; lawanCode: string; jumlah: number; keterangan: string | null; rekening: Rek[]; coa: Coa[];
}) {
  const [tanggal, setTanggal] = useState(initialDate); const [accountId, setAccountId] = useState(initialAccount); const [lawanCode, setLawanCode] = useState(initialLawan); const [jumlah, setJumlah] = useState(String(initialAmount)); const [keterangan, setKeterangan] = useState(initialNote ?? ""); const [reason, setReason] = useState("");
  const snapshot = { tanggal, accountId, lawanCode, jumlah, keterangan, reason };
  return <details><summary style={{ cursor: "pointer", color: "#2563eb", fontSize: 10.5 }}>Edit / koreksi</summary>
    <CorrectionTransactionForm userId={userId} scope={`cash-edit-${id}-${revision}`} action={koreksiKasEntry} state={{ snapshot, restore(value) {
      if (typeof value.tanggal !== "string" || typeof value.accountId !== "string" || typeof value.lawanCode !== "string" || typeof value.jumlah !== "string" || typeof value.keterangan !== "string" || typeof value.reason !== "string") return false;
      setTanggal(value.tanggal); setAccountId(value.accountId); setLawanCode(value.lawanCode); setJumlah(value.jumlah); setKeterangan(value.keterangan); setReason(value.reason); return true;
    }, reset() {} }}>
      {({ ready }) => <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
        <input type="hidden" name="id" value={id} /><input type="hidden" name="jenis" value={jenis} /><input type="hidden" name="revision" value={revision} />
        <label className="flab">Tanggal koreksi<input className="fi" type="date" name="tanggal" value={tanggal} onChange={(e) => setTanggal(e.target.value)} required /></label>
        <label className="flab">Rekening<select className="fi" name="account_id" value={accountId} onChange={(e) => setAccountId(e.target.value)}>{rekening.map((r) => <option key={r.id} value={r.id}>{r.nama}</option>)}</select></label>
        <label className="flab">Akun lawan<select className="fi" name="lawan_code" value={lawanCode} onChange={(e) => setLawanCode(e.target.value)}>{coa.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}</select></label>
        <label className="flab">Jumlah<NumberInput className="fi" type="number" min="0.01" step="0.01" name="jumlah" value={jumlah} onChange={(e) => setJumlah(e.target.value)} required /></label>
        <label className="flab">Keterangan<input className="fi" name="keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Keterangan" /></label>
        <label className="flab">Alasan koreksi<input className="fi" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wajib diisi" minLength={3} required /></label>
        <SubmitButton className="btn-def" pendingText="Menyimpan…" disabled={!ready || reason.trim().length < 3}>Simpan koreksi</SubmitButton>
      </div>}
    </CorrectionTransactionForm>
    <KasVoidForm userId={userId} jenis={jenis} id={id} revision={revision} />
  </details>;
}
