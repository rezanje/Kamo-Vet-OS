"use client";

import { NumberInput } from "@/components/NumberInput";
import { StokKurangDariPesan } from "@/components/StokKurangPopup";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewStockCorrection, saveStockCorrection, recoverStockCorrection } from "./actions";
import type { StockCorrectionKind, StockCorrectionRow, StockCorrectionPreview, StockCorrectionInput, StockCorrectionResult } from "@/lib/stock-correction-types";

type Submission = { rows: StockCorrectionInput[]; reason: string; key: string; token: string };
type Saved = { key: string; revision: number; quantities: Record<string, string>; reason: string; submission?: Submission };
const money = (n: number) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function StockCorrectionForm({ userId, kind, documentId, revision, rows }: {
  userId: string; kind: StockCorrectionKind; documentId: string; revision: number; rows: StockCorrectionRow[];
}) {
  const router = useRouter();
  const storage = `vetos:stock-correction:v1:${userId}:${kind}:${documentId}`;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [preview, setPreview] = useState<StockCorrectionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (cancelled) return;
    try {
      const raw = sessionStorage.getItem(storage);
      const initial: Saved = { key: crypto.randomUUID(), revision, quantities: Object.fromEntries(rows.map(r => [r.item_id, String(r.qty)])), reason: "" };
      let value: Saved = raw ? JSON.parse(raw) : initial;
      // A committed response can be lost while the server already serves the next
      // revision. Preserve the exact pending request across that refresh.
      if (value.revision !== revision && !value.submission) value = initial;
      if (typeof value.key !== "string" || !value.key || typeof value.reason !== "string" || !value.quantities || !rows.every(r => typeof value.quantities[r.item_id] === "string")) throw new Error("Invalid draft");
      if (value.submission && (!Array.isArray(value.submission.rows) || value.submission.key !== value.key || typeof value.submission.token !== "string" || typeof value.submission.reason !== "string")) throw new Error("Invalid submission");
      sessionStorage.setItem(storage, JSON.stringify(value));
      setSaved(value);
    } catch { setMessage("Draf koreksi tidak dapat dibaca atau disimpan. Periksa penyimpanan browser sebelum melanjutkan."); }
    });
    return () => { cancelled = true; };
  }, [storage, rows, revision]);

  function persist(next: Saved) {
    try { sessionStorage.setItem(storage, JSON.stringify(next)); setSaved(next); return true; }
    catch { setMessage("Draf belum tersimpan. Periksa penyimpanan browser sebelum melanjutkan."); return false; }
  }
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try { await work(); } catch { setMessage("Respons belum terkonfirmasi. Periksa hasil terakhir atau coba simpan ulang dengan permintaan yang sama."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function confirmed(result: StockCorrectionResult) {
    setDone(true);setMessage(`Koreksi revisi ${result.revision} tersimpan. Stok, jurnal, dan riwayat telah diperbarui.`);
    try { sessionStorage.removeItem(storage); } catch { /* Server result is authoritative. */ }
    router.refresh();
  }
  async function submit(submission: Submission) {
    const result = await saveStockCorrection(kind, documentId, submission.rows, submission.reason, submission.key, submission.token);
    if (result.data) confirmed(result.data);
    else {
      setMessage(result.error ?? "Hasil koreksi belum terkonfirmasi.");
      if (!result.uncertain && saved) { persist({ ...saved, revision, submission: undefined }); setPreview(null); }
    }
  }
  const inputs = rows.map(r => ({ item_id: r.item_id, qty: Number(saved?.quantities[r.item_id]) }));
  const valid = !!saved && saved.reason.trim().length >= 3 && saved.reason.length <= 1000 && rows.every(r => saved.quantities[r.item_id]?.trim() !== "" && Number.isFinite(Number(saved.quantities[r.item_id])) && Number(saved.quantities[r.item_id]) >= 0);

  return <div className="crm-sec">
    <h3>Koreksi jumlah oleh Super Admin</h3>
    <p>Masukkan jumlah yang seharusnya tercatat pada transaksi asal. Perubahan diterapkan sebagai selisih terhadap stok saat ini. Dokumen asal, jurnal pembalikan, dan pengganti tetap tersimpan.</p>
    <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>Barang</th><th>Jumlah tercatat</th><th>Jumlah yang benar</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.item_id}><td>{r.name}</td><td>{Number(r.qty)}</td><td><NumberInput className="fi" aria-label={`Jumlah benar ${r.name}`} name={`qty-${r.item_id}`} type="number" min="0" max="1000000000" step="any" value={saved?.quantities[r.item_id] ?? String(r.qty)} disabled={!saved || busy || !!saved.submission || done} onChange={e => { if (saved && persist({ ...saved, quantities: { ...saved.quantities, [r.item_id]: e.target.value } })) setPreview(null); }} /></td></tr>)}
    </tbody></table></div>
    <label className="flab" htmlFor={`stock-reason-${documentId}`}>Alasan koreksi</label>
    <input id={`stock-reason-${documentId}`} className="fi" name="reason" required minLength={3} maxLength={1000} value={saved?.reason ?? ""} disabled={!saved || busy || !!saved.submission || done} onChange={e => { if(saved) persist({ ...saved, reason: e.target.value }); }} />
    {message && <div role="status" className="p2ban">{message}</div>}
    {/* "Stok tidak cukup untuk koreksi" naik jadi popup yang sama dengan proses stok lain. */}
    <StokKurangDariPesan pesan={message} />
    {preview && <div role="region" aria-label="Preview dampak koreksi">
      <h4>Dampak sebelum disimpan</h4>
      {preview.lines.map(line => <p key={line.item_id}>{line.name}: jumlah transaksi {line.old_qty} → {line.new_qty}; stok sekarang {line.stock_before} → {line.stock_after} (selisih {line.delta}).</p>)}
      <p>Nilai persediaan transaksi: Rp {money(preview.value_before)} → Rp {money(preview.value_after)}. Dampak jurnal persediaan: Rp {money(preview.value_delta)}; akun selisih mencatat nilai berlawanan.</p>
    </div>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
      <button type="button" className="btn-def" disabled={!valid || busy || !!saved?.submission || done} onClick={() => run(async () => {
        const response = await previewStockCorrection(kind, documentId, inputs);
        setPreview(response.data ?? null); if (response.error) setMessage(response.error);
      })}>Periksa dampak koreksi</button>
      <button type="button" className="btn-acc" data-save disabled={!valid || !preview || busy || !!saved?.submission || done} onClick={() => run(async () => {
        if (!saved || !preview) return;
        const submission = { rows: inputs, reason: saved.reason.trim(), key: saved.key, token: preview.token };
        if (persist({ ...saved, submission })) await submit(submission);
      })}>Simpan koreksi</button>
      {saved?.submission && !done && <>
        <button type="button" className="btn-def" disabled={busy} onClick={() => run(async () => {
          const response = await recoverStockCorrection(kind, documentId, saved.key);
          if (response.data) confirmed(response.data);
          else setMessage(response.error ?? "Belum ada hasil tersimpan untuk permintaan ini. Coba simpan ulang dengan permintaan yang sama.");
        })}>Periksa hasil terakhir</button>
        <button type="button" className="btn-def" disabled={busy} onClick={() => run(async () => { if(saved.submission) await submit(saved.submission); })}>Coba simpan ulang</button>
      </>}
    </div>
  </div>;
}
