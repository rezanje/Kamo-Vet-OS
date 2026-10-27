"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { periksaSaldoAwalFaktur, postingSaldoAwalFaktur } from "./actions";
import type { OpeningInvoicePayload, OpeningInvoiceReceipt, OpeningInvoiceReport, OpeningInvoiceTotals } from "./types";

const rp = (n: number | null | undefined) => n === null || n === undefined ? "—" : "Rp " + Math.round(Number(n)).toLocaleString("id-ID");

function Kartu({ judul, t }: { judul: string; t: OpeningInvoiceTotals }) {
  const cocok = t.kontrol !== null && Number(t.kontrol) === Number(t.total);
  const kosong = t.jumlah_faktur === 0 && (t.kontrol === null || Number(t.kontrol) === 0);
  return <div className="card" style={{ background: kosong ? "var(--sf1)" : cocok ? "#e8f5ee" : "#fef2f2" }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tm)" }}>{judul}</div>
    <div style={{ fontSize: 13, fontWeight: 700 }}>{t.jumlah_faktur} faktur · {rp(t.total)}</div>
    <div style={{ fontSize: 11 }}>Total kontrol: {rp(t.kontrol)} {kosong ? "" : cocok ? "✓ cocok" : "✗ tidak cocok"}</div>
  </div>;
}

export function SaldoAwalFakturForm({ branches, defaultAsOf, isOwner }: { branches: { id: string; name: string }[]; defaultAsOf: string; isOwner: boolean }) {
  const [report, setReport] = useState<OpeningInvoiceReport | null>(null);
  const [payload, setPayload] = useState<OpeningInvoicePayload | null>(null);
  const [receipt, setReceipt] = useState<OpeningInvoiceReceipt | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const reset = () => { setReport(null); setPayload(null); setReceipt(null); setConfirmed(false); setError(""); };
  const periksa = (form: HTMLFormElement) => {
    if (busy.current) return;
    busy.current = true;
    const data = new FormData(form);
    startTransition(async () => {
      reset();
      try {
        const result = await periksaSaldoAwalFaktur(data);
        if (!result.ok) { setError(result.error); return; }
        setReport(result.report); setPayload(result.payload); setReceipt(result.report.receipt);
      } catch { setError("Hasil pemeriksaan belum diterima. Coba periksa ulang."); }
      finally { busy.current = false; }
    });
  };
  const posting = () => {
    if (!report || !payload || busy.current) return;
    busy.current = true;
    startTransition(async () => {
      setError("");
      try {
        const result = await postingSaldoAwalFaktur({ payload, expectedHash: report.source_hash, reason, confirmed });
        if (result.ok) setReceipt(result.receipt); else setError(result.error);
      } catch { setError("Respons posting tidak diterima. Periksa ulang file yang sama; sistem mencegah posting ganda."); }
      finally { busy.current = false; }
    });
  };

  const salah = report?.rows.filter(r => r.errors.length) ?? [];
  const benar = report?.rows.filter(r => !r.errors.length) ?? [];
  return <div style={{ display: "grid", gap: 12 }}>
    <form onSubmit={event => { event.preventDefault(); periksa(event.currentTarget); }} onChange={() => { if (report) reset(); }}
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10, alignItems: "end" }}>
      <label className="flab">File Excel (.xlsx) *
        <input className="fi" type="file" name="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={pending} />
      </label>
      <label className="flab">Tanggal saldo (cutover) *
        <input className="fi" type="date" name="as_of" required defaultValue={defaultAsOf} disabled={pending} />
      </label>
      <label className="flab">Cabang *
        <select className="fi" name="branch_id" required defaultValue={branches.length === 1 ? branches[0].id : ""} disabled={pending}>
          <option value="">— pilih cabang —</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className="flab">Total kontrol hutang (Accurate)
        <input className="fi" name="kontrol_hutang" inputMode="numeric" placeholder="mis. 125.000.000" disabled={pending} />
      </label>
      <label className="flab">Total kontrol piutang (Accurate)
        <input className="fi" name="kontrol_piutang" inputMode="numeric" placeholder="kosongkan bila tidak ada" disabled={pending} />
      </label>
      <button type="submit" className="btn-def" disabled={pending}>{pending && !report ? "Memeriksa…" : "Periksa file"}</button>
    </form>

    {error && <div className="p2ban" role="alert" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>{error}</div>}

    {report && <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
        <Kartu judul="HUTANG (2101)" t={report.totals.hutang} />
        <Kartu judul="PIUTANG (1201)" t={report.totals.piutang} />
        <div className="card" style={{ background: "var(--sf1)" }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tm)" }}>FILE</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{report.source_name}</div>
          <div style={{ fontSize: 11 }}>{report.rows.length} baris · {report.error_rows} bermasalah · cabang {report.branch_name} · per {report.as_of}</div>
        </div>
      </div>

      {report.status === "posted" && <div className="p2ban" role="status">File yang sama sudah pernah diposting. Tidak ada yang akan dicatat ulang.</div>}
      {report.blockers.length > 0 && <div className="p2ban" role="alert" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
        <strong>Belum bisa diposting:</strong>
        <ul style={{ margin: "4px 0 0 18px" }}>{report.blockers.map(b => <li key={b}>{b}</li>)}</ul>
      </div>}

      {salah.length > 0 && <div>
        <h3 style={{ fontSize: 13, margin: "4px 0" }}>Baris bermasalah ({salah.length}) — perbaiki di Excel lalu periksa ulang</h3>
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 820 }}>
          <thead><tr><th>Baris</th><th>Jenis</th><th>Nama pihak</th><th>No faktur</th><th style={{ textAlign: "right" }}>Sisa</th><th>Masalah</th></tr></thead>
          <tbody>{salah.map(r => <tr key={r.baris}>
            <td style={{ fontSize: 11 }}>{r.baris > 100000 ? `Piutang ${r.baris - 100000}` : r.baris}</td><td style={{ fontSize: 11 }}>{r.jenis}</td>
            <td style={{ fontSize: 11 }}>{r.nama_pihak}</td><td style={{ fontSize: 11 }}>{r.no_faktur}</td>
            <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sisa)}</td>
            <td style={{ fontSize: 11, color: "#b91c1c" }}>{r.errors.join(" · ")}</td>
          </tr>)}</tbody>
        </table></div>
      </div>}

      <div>
        <h3 style={{ fontSize: 13, margin: "4px 0" }}>Total per pihak</h3>
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 560 }}>
          <thead><tr><th>Jenis</th><th>Pihak</th><th>Cocok master</th><th style={{ textAlign: "right" }}>Faktur</th><th style={{ textAlign: "right" }}>Sisa</th></tr></thead>
          <tbody>{report.parties.map(p => <tr key={`${p.jenis}:${p.party_id ?? p.nama}`}>
            <td style={{ fontSize: 11 }}>{p.jenis}</td><td style={{ fontSize: 11 }}>{p.nama}</td>
            <td style={{ fontSize: 11 }}>{p.party_id ? "Ya, lewat nama" : <span style={{ color: "#b91c1c" }}>Tidak</span>}</td>
            <td style={{ textAlign: "right", fontSize: 11 }}>{p.jumlah_faktur}</td><td style={{ textAlign: "right", fontSize: 11 }}>{rp(p.total)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th colSpan={3}>Total semua</th>
            <th style={{ textAlign: "right" }}>{report.totals.hutang.jumlah_faktur + report.totals.piutang.jumlah_faktur}</th>
            <th style={{ textAlign: "right" }}>{rp(Number(report.totals.hutang.total) + Number(report.totals.piutang.total))}</th></tr></tfoot>
        </table></div>
      </div>

      {benar.length > 0 && <details>
        <summary style={{ cursor: "pointer", fontSize: 12 }}>Lihat {benar.length} baris yang siap</summary>
        <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 820 }}>
          <thead><tr><th>Baris</th><th>Jenis</th><th>Pihak (master)</th><th>No faktur</th><th>Tanggal</th><th>Jatuh tempo</th><th style={{ textAlign: "right" }}>Sisa</th></tr></thead>
          <tbody>{benar.map(r => <tr key={r.baris}>
            <td style={{ fontSize: 11 }}>{r.baris > 100000 ? `Piutang ${r.baris - 100000}` : r.baris}</td><td style={{ fontSize: 11 }}>{r.jenis}</td>
            <td style={{ fontSize: 11 }}>{r.party_name}</td><td style={{ fontSize: 11 }}>{r.no_faktur}</td>
            <td style={{ fontSize: 11 }}>{r.tanggal}</td><td style={{ fontSize: 11 }}>{r.jatuh_tempo}</td>
            <td style={{ textAlign: "right", fontSize: 11 }}>{rp(r.sisa)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}

      {receipt ? <div className="p2ban" role="status" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
        Terposting{receipt.replayed ? " (sudah ada sebelumnya, tidak dicatat ulang)" : ""}: jurnal {receipt.no_jurnal} per {receipt.as_of} ·
        hutang {receipt.hutang.jumlah_faktur} faktur {rp(receipt.hutang.total)} · piutang {receipt.piutang.jumlah_faktur} faktur {rp(receipt.piutang.total)}.{" "}
        <Link href="/keuangan/hutang">Buka Pembayaran Hutang</Link> · <Link href="/keuangan/piutang">Buka Piutang</Link>
      </div> : isOwner ? <div style={{ display: "grid", gap: 8, maxWidth: 640 }}>
        <label className="flab">Alasan audit (10–1.000 karakter) *
          <textarea className="fi" rows={2} value={reason} onChange={e => setReason(e.target.value)} disabled={pending || !report.can_post}
            placeholder="mis. Cutover Accurate 31 Oktober 2026, sesuai laporan umur hutang/piutang" />
        </label>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={pending || !report.can_post} />
          Saya sudah mencocokkan total per pihak dan total kontrol dengan laporan Accurate. Posting membuat faktur saldo awal yang tidak dapat dihapus.
        </label>
        <button type="button" className="pay-btn" onClick={posting} disabled={pending || !report.can_post || !confirmed || reason.trim().length < 10}>
          {pending ? "Memposting…" : "Posting saldo awal per faktur"}
        </button>
      </div> : <p style={{ fontSize: 12, color: "var(--tm)" }}>Hasil pemeriksaan siap ditinjau. Posting hanya oleh OWNER.</p>}
    </>}
  </div>;
}
