"use client";

import { NumberInput } from "@/components/NumberInput";

import { useState } from "react";
import { CorrectionTransactionForm } from "@/components/CorrectionTransactionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { draftString } from "@/components/TransactionDraft";
import { recurringSourceBounds, recurringSourcePeriodIndex } from "@/lib/recurring-source";
import { SecHeader } from "@/components/SecHeader";
import { startRecurringFromJournal } from "./actions";

type SourceLine = { line_id: string; account_id: string; code: string; debit: number; credit: number };
type Source = {
  entry_id: string; no_jurnal: string; tanggal: string; branch_id: string | null; revision: number;
  source: string; deskripsi: string | null; version: string; lines: SourceLine[];
};

const money = (value: number) => `Rp ${Number(value).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SourceRecurringForm({ userId, source, firstPeriod, currentPeriod }: {
  userId: string; source: Source; firstPeriod: string; currentPeriod: string;
}) {
  const scope = `j04-source-${source.entry_id}`;
  const [name, setName] = useState("");
  const [first, setFirst] = useState(firstPeriod);
  const [day, setDay] = useState("1");
  const [count, setCount] = useState("12");
  const [end, setEnd] = useState("");
  const [confirmSource, setConfirmSource] = useState(false);
  const [confirmBackdate, setConfirmBackdate] = useState(false);
  const firstIndex = recurringSourcePeriodIndex(first);
  const currentIndex = recurringSourcePeriodIndex(currentPeriod);
  const sourceIndex = recurringSourcePeriodIndex(source.tanggal.slice(0, 7));
  const isBackdated = firstIndex !== null && currentIndex !== null && firstIndex < currentIndex;
  const parsedCount = count.trim() ? Number(count) : null;
  let validBounds = false;
  try {
    recurringSourceBounds(first, parsedCount, end.trim() || null);
    validBounds = true;
  } catch { /* The server remains authoritative for the saved schedule. */ }
  const valid = !!name.trim() && name.trim().length <= 80 && Number.isInteger(Number(day))
    && Number(day) >= 1 && Number(day) <= 28 && firstIndex !== null && sourceIndex !== null && firstIndex > sourceIndex
    && validBounds && confirmSource && (!isBackdated || confirmBackdate);
  const serializedSource = JSON.stringify(source);

  return (
    <CorrectionTransactionForm userId={userId} scope={scope} action={startRecurringFromJournal} state={{
      snapshot: { name, first, day, count, end },
      restore(value) {
        if (![value.name, value.first, value.day, value.count, value.end].every(draftString)) return false;
        setName(value.name as string); setFirst(value.first as string); setDay(value.day as string); setCount(value.count as string); setEnd(value.end as string);
        return true;
      },
      reset() { setName(""); setFirst(firstPeriod); setDay("1"); setCount("12"); setEnd(""); setConfirmSource(false); setConfirmBackdate(false); },
    }}>
      {({ ready }) => (
        <div className="crm-sec">
          <SecHeader num="02" title="BUAT JADWAL DARI JURNAL" desc="Buat jadwal bulanan manual dari nilai dan akun jurnal sumber yang sama. Tidak ada jurnal yang dibuat sampai Anda menjalankan periode yang jatuh tempo." />
          <input type="hidden" name="source_entry_id" value={source.entry_id} data-draft-ignore="" />
          <input type="hidden" name="expected_snapshot" value={serializedSource} data-draft-ignore="" />
          <div style={{ display: "grid", gap: 10, maxWidth: 900 }}>
            <div className="p2ban" style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e3a8a" }}>
              Jurnal sumber <strong>{source.no_jurnal}</strong> · {source.tanggal} · {source.source === "manual-correction" ? "Koreksi manual" : "Manual"}
              <div style={{ marginTop: 4 }}>{source.deskripsi || "(tanpa keterangan)"}</div>
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table className="tbl" style={{ minWidth: 420, background: "white" }}>
                  <thead><tr><th>Akun</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Kredit</th></tr></thead>
                  <tbody>{source.lines.map((line) => <tr key={line.line_id}>
                    <td>{line.code}</td><td style={{ textAlign: "right" }}>{money(Number(line.debit))}</td><td style={{ textAlign: "right" }}>{money(Number(line.credit))}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="fg" style={{ flex: 2, minWidth: 220, marginBottom: 0 }}>
                <label className="flab" htmlFor="source-schedule-name">Nama jadwal *</label>
                <input id="source-schedule-name" className="fi" name="name" value={name} maxLength={80} required placeholder="Mis. Amortisasi sewa tahunan" onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="fg" style={{ minWidth: 155, marginBottom: 0 }}>
                <label className="flab" htmlFor="source-schedule-first">Periode pertama *</label>
                <input id="source-schedule-first" className="fi" type="month" name="first_period" value={first} required onChange={(event) => setFirst(event.target.value)} />
              </div>
              <div className="fg" style={{ width: 135, marginBottom: 0 }}>
                <label className="flab" htmlFor="source-schedule-day">Tanggal posting *</label>
                <NumberInput id="source-schedule-day" className="fi" type="number" name="day" min={1} max={28} step={1} value={day} required onChange={(event) => setDay(event.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <div className="fg" style={{ width: 220, marginBottom: 0 }}>
                <label className="flab" htmlFor="source-schedule-count">Jumlah bulan</label>
                <NumberInput id="source-schedule-count" className="fi" type="number" name="count" min={1} step={1} value={count} onChange={(event) => { setCount(event.target.value); setEnd(""); }} />
              </div>
              <div className="fg" style={{ minWidth: 180, marginBottom: 0 }}>
                <label className="flab" htmlFor="source-schedule-end">Atau bulan terakhir</label>
                <input id="source-schedule-end" className="fi" type="month" name="end_period" value={end} onChange={(event) => { setEnd(event.target.value); if (event.target.value) setCount(""); else setCount("12"); }} />
              </div>
              <span style={{ alignSelf: "center", color: "var(--td)", fontSize: 11 }}>Jika keduanya diisi, jumlah dan bulan akhir harus cocok.</span>
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
              <input type="checkbox" name="confirm_source" value="1" required checked={confirmSource} data-draft-ignore="" onChange={(event) => setConfirmSource(event.target.checked)} />
              Saya sudah memeriksa jurnal sumber dan ingin menyalin akun serta nilainya persis ke jadwal.
            </label>
            {isBackdated && <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
              <input type="checkbox" name="confirm_backdated" value="1" required checked={confirmBackdate} data-draft-ignore="" onChange={(event) => setConfirmBackdate(event.target.checked)} />
              Periode pertama sudah lewat menurut WIB. Saya meminta membuat jadwal mundur; tiap posting tetap memeriksa periode tutup buku.
            </label>}
            <div style={{ color: "var(--td)", fontSize: 11 }}>
              Jadwal ini manual: menyimpan jadwal tidak membuat jurnal baru. Setiap klik hanya menjalankan satu periode tertua yang jatuh tempo. Pembayaran bank tidak dibuat.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <SubmitButton className="btn-acc" disabled={!ready || !valid} pendingText="Menyimpan jadwal…">Simpan jadwal</SubmitButton>
            </div>
          </div>
        </div>
      )}
    </CorrectionTransactionForm>
  );
}
