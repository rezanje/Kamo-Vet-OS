"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NumberInput } from "@/components/NumberInput";
import { METODE_BAYAR } from "@/lib/kas-akun";
import type { RanapPaymentAccount, RanapPaymentQuote } from "@/lib/ranap-payment";
import { simpanBayar } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const colors = ["#15803d", "#1d4ed8", "#7c3aed", "#be185d", "#0369a1", "#b45309"];
export function SimpanBayarForm({ recordId, visitId, requestKey, remaining, pendingCount, accounts, dpOpsional, bolehTerobos = false }: {
  recordId: string; visitId: string; requestKey: string; remaining: number; pendingCount: number;
  accounts: RanapPaymentAccount[]; dpOpsional?: number; bolehTerobos?: boolean;
}) {
  const router = useRouter();
  const [parts, setParts] = useState([{ method: "Tunai", amount: "" }]);
  const [creditMode, setCreditMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ quote: RanapPaymentQuote; draft: FormData } | null>(null);
  const total = parts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const excess = Math.max(0, total - remaining);
  const typed = parts.some(p => p.amount.trim() !== "" && Number(p.amount) !== 0);
  const blocked = busy || (!creditMode && remaining === 0 && pendingCount === 0) || (total === 0 && pendingCount === 0);
  function change(index: number, patch: Partial<typeof parts[number]>) {
    setConfirmation(null);
    setParts(prev => prev.map((p, i) => i === index ? { ...p, ...patch } : p));
  }
  async function send(draft: FormData) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const result = await simpanBayar(draft);
      if (result.status === "OVERPAYMENT_CONFIRM_REQUIRED") setConfirmation({ quote: result.quote, draft });
      else if (result.status === "SAVED") { router.push(result.href); router.refresh(); }
      else setError(result.error);
    } catch {
      setError("Hasil penyimpanan belum dapat dipastikan. Muat ulang dan periksa riwayat sebelum mencoba lagi.");
    } finally { submitting.current = false; setBusy(false); }
  }
  return <form onSubmit={e => { e.preventDefault(); if (!blocked) void send(new FormData(e.currentTarget)); }}>
    <input type="hidden" name="recordId" value={recordId} />
    <input type="hidden" name="visitId" value={visitId} />
    <input type="hidden" name="requestKey" value={requestKey} />
    <input type="hidden" name="parts" value={JSON.stringify(parts.filter(p => Number(p.amount) > 0).map(p => ({ method: p.method, amount: Number(p.amount) })))} />
    <input type="hidden" name="add_owner_credit" value={String(creditMode)} />
    <fieldset disabled={busy || !!confirmation} style={{ border: 0, padding: 0, margin: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>METODE PEMBAYARAN</div>
      {parts.map((part, index) => {
        const account = accounts.find(a => a.method === part.method);
        return <div key={index} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {METODE_BAYAR.map((method, i) => <button type="button" key={method} aria-pressed={part.method === method}
              aria-label={parts.length > 1 ? `${method} bagian ${index + 1}` : method}
              onClick={() => change(index, { method, ...(method !== "Tunai" && !typed ? { amount: String(remaining) } : {}) })}
              style={{ padding: "12px 16px", borderRadius: 8, fontSize: 15, fontWeight: 800,
                border: `2px solid ${colors[i]}`, background: part.method === method ? colors[i] : "white", color: part.method === method ? "white" : colors[i] }}>{method}</button>)}
          </div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            {account ? <><b>{account.name}</b>{account.bank ? ` · ${account.bank}` : ""}{account.number ? ` · ${account.number}` : ""} <small>({account.code})</small></> : "Rekening belum terbaca"}
          </div>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Jumlah {parts.length > 1 ? index + 1 : ""} (Rp)
            <NumberInput className="fi" type="number" min={0} step={1} aria-label={`Nominal pembayaran ${index + 1}`}
              value={part.amount} onChange={e => change(index, { amount: e.currentTarget.value })}
              style={{ fontSize: 26, fontWeight: 800, padding: 12, marginTop: 4, maxWidth: 380 }} />
          </label>
          {parts.length > 1 && <button type="button" className="btn-def" onClick={() => setParts(prev => prev.filter((_, i) => i !== index))}>Hapus bagian {index + 1}</button>}
        </div>;
      })}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <button type="button" className="btn-def" disabled={parts.length >= 6} onClick={() => setParts(prev => [...prev, { method: "Transfer", amount: "" }])}>Tambah metode</button>
        {dpOpsional !== undefined && <button type="button" className="btn-def" disabled={typed || dpOpsional <= 0}
          onClick={() => change(0, { amount: String(dpOpsional) })}>Isi DP 50% sisa total</button>}
      </div>
      {bolehTerobos && <details style={{ marginBottom: 10 }}><summary>Pengecualian DP awal</summary>
        <label>Alasan penerobosan DP<input className="fi" name="dp_override_reason" maxLength={500} /></label>
      </details>}
      {remaining === 0 && pendingCount === 0 && <label style={{ display: "block", marginBottom: 10 }}>
        <input type="checkbox" checked={creditMode} onChange={e => setCreditMode(e.target.checked)} /> Tambah saldo pemilik
      </label>}
    </fieldset>
    {excess > 0 && <div role="alert" style={{ background: "#fff7ed", border: "2px solid #ea580c", borderRadius: 8, padding: 14, fontSize: 19, fontWeight: 800, color: "#9a3412", marginBottom: 12 }}>Lebih {rp(excess)} disimpan sebagai saldo pemilik</div>}
    {error && <div role="alert" style={{ color: "#b91c1c", padding: 10 }}>{error}</div>}
    <button className="btn-acc" type="submit" disabled={blocked || !!confirmation} style={{ fontSize: 19, fontWeight: 800, padding: "14px 22px" }}>
      {busy ? "Menyimpan…" : total > 0 ? `Simpan / Bayar ${rp(total)}` : "Simpan transaksi · Bayar nanti"}
    </button>
    {confirmation && <div role="dialog" aria-modal="true" aria-label="Konfirmasi kelebihan bayar" style={{ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", background: "#0008", padding: 20 }}>
      <div style={{ background: "white", border: "3px solid #ea580c", borderRadius: 12, padding: 24, maxWidth: 520 }}>
        <h2 style={{ color: "#9a3412" }}>{confirmation.quote.excess > 0 ? "Periksa pembayaran" : "Tagihan berubah"}</h2>
        <div style={{ fontSize: 18 }}>Sisa tagihan terkini: <b>{rp(confirmation.quote.remaining)}</b></div>
        <div style={{ fontSize: 18 }}>Uang diterima: <b>{rp(confirmation.quote.amount)}</b></div>
        <p style={{ fontSize: 23, fontWeight: 800, color: "#9a3412" }}>{confirmation.quote.excess > 0 ? `Lebih ${rp(confirmation.quote.excess)} disimpan sebagai saldo pemilik` : "Tidak ada kelebihan bayar."}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button autoFocus type="button" className="btn-def" disabled={busy} onClick={() => setConfirmation(null)}>Batal</button>
          <button type="button" className="btn-acc" disabled={busy} onClick={() => {
            const draft = new FormData(); confirmation.draft.forEach((value, key) => draft.append(key, value));
            draft.set("overpayment_ack", confirmation.quote.token); void send(draft);
          }}>{confirmation.quote.excess > 0 ? "Setuju, simpan saldo pemilik" : "Setuju, lanjutkan pembayaran"}</button>
        </div>
      </div>
    </div>}
  </form>;
}
