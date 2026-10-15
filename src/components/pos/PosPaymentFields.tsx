"use client";

import { POS_PAYMENT_METHODS, resolvePosPayments, type PosPaymentPart } from "@/lib/pos-payments";

const rp = (amount: number) => "Rp " + amount.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function PosPaymentFields({ total, split, payments, bayar, onSplitChange, onPaymentsChange, onBayarChange }: {
  total: number;
  split: boolean;
  payments: PosPaymentPart[];
  bayar: number;
  onSplitChange: (split: boolean) => void;
  onPaymentsChange: (payments: PosPaymentPart[]) => void;
  onBayarChange: (bayar: number) => void;
}) {
  const cash = payments.find(part => part.method === "Tunai")?.amount ?? 0;
  const hasCash = payments.some(part => part.method === "Tunai");
  const remaining = (Math.round(total * 100) - payments.reduce((sum, part) => sum + Math.round(part.amount * 100), 0)) / 100;
  const cashChange = (Math.round(bayar * 100) - Math.round(cash * 100)) / 100;
  let error = "";
  if (split) {
    try { resolvePosPayments({ total, method: "Split", bayar, payments }); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Periksa rincian pembayaran."; }
  }

  const update = (next: PosPaymentPart[]) => {
    const nextCash = next.find(part => part.method === "Tunai")?.amount ?? 0;
    onPaymentsChange(next);
    if (!next.some(part => part.method === "Tunai") || bayar === cash) onBayarChange(nextCash);
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, cursor: "pointer", marginBottom: split ? 7 : 0 }}>
        <input type="checkbox" aria-label="Bayar Gabungan" checked={split} disabled={total <= 0 && !split}
          onChange={event => {
            const enabled = event.target.checked;
            if (enabled) {
              const next = payments.length ? payments : [{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }];
              onPaymentsChange(next);
              onBayarChange(next.find(part => part.method === "Tunai")?.amount ?? 0);
            }
            onSplitChange(enabled);
          }} />
        Bayar Gabungan
      </label>
      {split && (
        <div style={{ padding: 8, border: "1px solid var(--bd)", borderRadius: 6 }}>
          {payments.map((part, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 5, marginBottom: 6 }}>
              <select className="fi" aria-label={`Metode pembayaran ${index + 1}`} value={part.method}
                onChange={event => update(payments.map((current, i) => i === index ? { ...current, method: event.target.value } : current))}
                style={{ minWidth: 0, padding: "4px 5px", fontSize: 10.5 }}>
                {POS_PAYMENT_METHODS.map(method => (
                  <option key={method} value={method} disabled={payments.some((current, i) => i !== index && current.method === method)}>{method}</option>
                ))}
              </select>
              <input className="fi" type="number" min={0} step="0.01" inputMode="decimal" aria-label={`Nominal pembayaran ${index + 1}`}
                placeholder="Nominal" value={part.amount || ""}
                onChange={event => update(payments.map((current, i) => i === index ? { ...current, amount: Number(event.target.value) } : current))}
                style={{ minWidth: 0, padding: "4px 5px", fontSize: 10.5, textAlign: "right" }} />
              <button className="back-btn" type="button" aria-label={`Hapus pembayaran ${index + 1}`} disabled={payments.length <= 1}
                onClick={() => update(payments.filter((_, i) => i !== index))} style={{ padding: "3px 4px", color: "#b91c1c" }}>×</button>
            </div>
          ))}
          <button className="back-btn" type="button" disabled={payments.length >= POS_PAYMENT_METHODS.length}
            onClick={() => {
              const method = POS_PAYMENT_METHODS.find(candidate => !payments.some(part => part.method === candidate));
              if (method) update([...payments, { method, amount: 0 }]);
            }} style={{ fontSize: 10, padding: "3px 0" }}>Tambah metode</button>
          <div aria-live="polite" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 5, color: remaining === 0 ? "#15803d" : "#b91c1c" }}>
            <span>{remaining > 0 ? "Sisa" : remaining < 0 ? "Kelebihan" : "Pembayaran pas"}</span>
            <span>{rp(Math.abs(remaining))}</span>
          </div>
          {hasCash && (
            <div style={{ marginTop: 7 }}>
              <label style={{ display: "block", fontSize: 10.5, marginBottom: 4 }}>
                Uang tunai diterima
                <input className="fi" type="number" min={0} step="0.01" inputMode="decimal" aria-label="Uang tunai diterima"
                  value={bayar || ""} onChange={event => onBayarChange(Number(event.target.value))} style={{ marginTop: 4, textAlign: "right" }} />
              </label>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: cashChange < 0 ? "#b91c1c" : "#15803d" }}>
                <span>{cashChange < 0 ? "Tunai kurang" : "Kembalian tunai"}</span>
                <span>{rp(Math.abs(cashChange))}</span>
              </div>
            </div>
          )}
          {error && remaining === 0 && <div role="status" style={{ color: "#b91c1c", fontSize: 10, marginTop: 5 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
