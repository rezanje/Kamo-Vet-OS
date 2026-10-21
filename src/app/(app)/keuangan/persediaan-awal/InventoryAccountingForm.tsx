"use client";

import { useState, useTransition } from "react";
import { postInventoryAccounting, previewInventoryAccounting } from "./actions";
import type { InventoryAccountingAccount, InventoryAccountingBatch, InventoryAccountingReceipt, InventoryAccountingReport } from "./types";

const money = (value: number | string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));

export function InventoryAccountingForm({ batches, accounts, initialRunId = "" }: { batches: InventoryAccountingBatch[]; accounts: InventoryAccountingAccount[]; initialRunId?: string }) {
  const [runId, setRunId] = useState(batches.some(batch => batch.id === initialRunId) ? initialRunId : "");
  const [equityId, setEquityId] = useState("");
  const [report, setReport] = useState<InventoryAccountingReport | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<InventoryAccountingReceipt | null>(null);
  const [pending, startTransition] = useTransition();

  const clearPreview = () => { setReport(null); setReceipt(null); setConfirmed(false); setError(""); setUncertain(false); };
  const preview = () => startTransition(async () => {
    setError("");
    try {
      const result = await previewInventoryAccounting(runId, equityId);
      if (!result.ok) { setError(result.error); return; }
      setReport(result.report); setReceipt(result.report.receipt); setConfirmed(false); setUncertain(false);
    } catch {
      setError("Laporan belum diterima. Coba muat laporan kembali.");
    }
  });
  const post = () => {
    if (!report) return;
    startTransition(async () => {
      setError("");
      try {
        const result = await postInventoryAccounting({ report, reason, confirmed });
        if (result.ok) { setReceipt(result.receipt); setUncertain(false); }
        else { setError(result.error); setUncertain(true); }
      } catch {
        setError("Respons posting tidak diterima. Periksa laporan batch atau kirim ulang permintaan yang sama.");
        setUncertain(true);
      }
    });
  };
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ report, receipt }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `persediaan-awal-${report.run_id}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const canPost = Boolean(report?.can_post && report.status === "previewed" && !report.blockers.length && confirmed && reason.trim().length >= 10 && reason.trim().length <= 1000 && !receipt && !pending);
  // Keep a request whose outcome may be uncertain unchanged until a read or exact retry resolves it.
  const freezeRequest = pending || uncertain;

  return <div style={{ display: "grid", gap: 12 }}>
    <label style={{ display: "grid", gap: 5 }}>Batch Accurate
      <select aria-label="Batch Accurate" className="fi" value={runId} disabled={freezeRequest} onChange={event => { setRunId(event.target.value); clearPreview(); }}>
        <option value="">Pilih batch</option>
        {batches.map(batch => <option key={batch.id} value={batch.id}>{batch.source_name} · {batch.as_of_date ?? "tanpa tanggal"} · {batch.status} · {batch.id.slice(0, 8)}</option>)}
      </select>
    </label>
    <label style={{ display: "grid", gap: 5 }}>Akun lawan ekuitas yang sudah diputuskan
      <select aria-label="Akun ekuitas" className="fi" value={equityId} disabled={freezeRequest} onChange={event => { setEquityId(event.target.value); clearPreview(); }}>
        <option value="">Pilih akun ekuitas</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
      </select>
    </label>
    <div><button type="button" className="btn-def" disabled={pending || !runId || !equityId} onClick={preview}>{pending ? "Memproses…" : uncertain ? "Periksa hasil batch" : "Preview / laporan tanpa posting"}</button></div>
    {error && <div className="p2ban" role="alert" style={{ color: "#b91c1c" }}>{error}</div>}
    {uncertain && <p role="status">Hasil belum dapat dipastikan. Pilihan dan alasan disimpan agar pengiriman ulang memakai permintaan yang sama. Periksa laporan batch untuk menemukan bukti posting yang sudah tersimpan.</p>}
    {report && <section aria-label="Laporan rekonsiliasi" style={{ border: "1px solid var(--bd)", borderRadius: 8, padding: 14 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{report.status === "previewed" ? "Tinjauan posting batch baru" : "Laporan batch historis"}</h2>
      <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr", gap: 8, fontSize: 12, overflowWrap: "anywhere" }}>
        <dt>Cabang / gudang</dt><dd style={{ margin: 0 }}>{report.branch_name} / {report.warehouse_name}</dd>
        <dt>Tanggal posisi</dt><dd style={{ margin: 0 }}>{report.as_of}</dd>
        <dt>Batch / sumber</dt><dd style={{ margin: 0 }}>{report.run_id}<br />{report.source_name}<br />Hash: {report.source_hash}</dd>
        <dt>Baris terpilih / lainnya</dt><dd style={{ margin: 0 }}>{report.selected_rows} / {report.excluded_rows}</dd>
        <dt>Qty asli</dt><dd style={{ margin: 0 }}>{Number(report.original_qty).toLocaleString("id-ID", { maximumFractionDigits: 6 })}</dd>
        <dt>Nilai asli impor</dt><dd style={{ margin: 0 }}>{money(report.original_value)}</dd>
        <dt>Nilai FIFO tersisa</dt><dd style={{ margin: 0 }}>{money(report.remaining_value)} — informasi pembanding, bukan dasar jurnal historis</dd>
        <dt>Debit persediaan</dt><dd style={{ margin: 0 }}>{report.inventory_account ? `${report.inventory_account.code} — ${report.inventory_account.name}` : "Akun belum valid"} · {money(report.original_value)}</dd>
        <dt>Kredit ekuitas</dt><dd style={{ margin: 0 }}>{report.equity_account ? `${report.equity_account.code} — ${report.equity_account.name}` : "Akun belum valid"} · {money(report.original_value)}</dd>
      </dl>
      {report.blockers.length > 0 && <div role="status"><strong>Keputusan / pemeriksaan diperlukan</strong><ul>{report.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul></div>}
      {report.status !== "previewed" && !receipt && <p>Batch ini hanya dapat ditinjau. Tidak ada tindakan perbaikan historis yang akan dijalankan dari laporan ini.</p>}
      <button type="button" className="btn-def" onClick={download}>Unduh laporan JSON</button>
      <details style={{ marginTop: 10 }}><summary>Bukti lengkap untuk peninjauan</summary><pre style={{ maxHeight: 300, overflow: "auto", fontSize: 10 }}>{JSON.stringify(report, null, 2)}</pre></details>
      {report.can_post && report.status === "previewed" && !receipt && <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <label style={{ display: "grid", gap: 5 }}>Alasan audit dan dasar pemilihan ekuitas
          <textarea aria-label="Alasan audit" className="fi" minLength={10} maxLength={1000} value={reason} disabled={freezeRequest} onChange={event => setReason(event.target.value)} />
        </label>
        <label><input type="checkbox" checked={confirmed} disabled={freezeRequest} onChange={event => setConfirmed(event.target.checked)} /> Saya sudah mencocokkan batch, tanggal, nilai, cabang, dan akun ekuitas di atas.</label>
        <div><button type="button" className="btn-acc" disabled={!canPost} onClick={post}>{pending ? "Posting…" : uncertain ? "Kirim ulang permintaan yang sama" : "Posting stok + jurnal cabang"}</button></div>
      </div>}
    </section>}
    {receipt && <section role="status" style={{ background: "#f0fdf4", padding: 14, borderRadius: 8 }}><strong>Bukti posting batch tersimpan</strong><p>Periksa jurnal dan Neraca pada cabang serta tanggal yang tercantum dalam bukti.</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 11 }}>{JSON.stringify(receipt, null, 2)}</pre></section>}
  </div>;
}
