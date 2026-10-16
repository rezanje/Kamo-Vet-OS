"use client";

import { POS_PAYMENT_METHODS, resolvePosPayments, type PosPaymentPart } from "@/lib/pos-payments";
import { quotePosMerchantFees } from "@/lib/pos-merchant-fees";

const rp = (amount: number) => "Rp " + amount.toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function PosPaymentFields({ total, split, payments, bayar, method, feePercent, onFeePercentChange, onSplitChange, onPaymentsChange, onBayarChange }: {
  total: number;
  method: string;
  feePercent: number;
  onFeePercentChange: (rate: number) => void;
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
    try {
      const quote = quotePosMerchantFees({ total, method: "Split", payments });
      resolvePosPayments({ total: quote.total, method: "Split", bayar, payments: quote.parts });
    }
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
              const next = payments.length ? payments.map(part => ({ method: part.method, amount: part.amount })) : [{ method: "Tunai", amount: 0 }, { method: "Transfer", amount: 0 }];
              onPaymentsChange(next);
              onBayarChange(next.find(part => part.method === "Tunai")?.amount ?? 0);
            }
            onSplitChange(enabled);
          }} />
        Bayar Gabungan
      </label>
      {!split && method && method !== "Tunai" && <FeeInput method={method} value={feePercent} onChange={onFeePercentChange} />}
      {split && (
        <div style={{ padding: 8, border: "1px solid var(--bd)", borderRadius: 6 }}>
          <p style={{ margin: "0 0 7px", fontSize: 10, color: "var(--tm)" }}>Bagi tagihan barang sebelum fee. Fee ditambahkan per metode.</p>
          {payments.map((part, index) => (
            <div key={index} style={{ marginBottom: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto", gap: 5, marginBottom: 6 }}>
                <select className="fi" aria-label={`Metode pembayaran ${index + 1}`} value={part.method}
                  onChange={event => update(payments.map((current, i) => i === index ? { method: event.target.value, amount: current.amount } : current))}
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
              {part.method !== "Tunai" && <FeeInput method={part.method} value={part.feePercent ?? 0} onChange={rate => update(payments.map((current, i) => i === index
                ? { method: current.method, amount: current.amount, ...(rate ? { feePercent: rate } : {}) } : current))} />}
              <PartTotal part={part} />
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

function FeeInput({ method, value, onChange }: { method: string; value: number; onChange: (value: number) => void }) {
  return <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, gap: 6, margin: "6px 0" }}>
    <span>Fee merchant {method} (%)</span>
    <input className="fi" type="number" min={0} max={100} step="0.01" inputMode="decimal" aria-label={`Fee merchant ${method} (%)`}
      value={value} onChange={event => onChange(Number(event.target.value))} style={{ width: 80, minWidth: 0, padding: "4px 5px", textAlign: "right" }} />
  </label>;
}

function PartTotal({ part }: { part: PosPaymentPart }) {
  let quote: ReturnType<typeof quotePosMerchantFees> | null = null;
  try {
    quote = quotePosMerchantFees({ total: part.amount, method: part.method, feePercent: part.feePercent ?? 0 });
  } catch { /* Invalid input remains editable; checkout stays disabled. */ }
  if (!quote) {
    return <div role="status" style={{ color: "#b91c1c", fontSize: 10 }}>Periksa nominal dan persentase fee {part.method} (0–100%, maksimal 2 desimal).</div>;
  }
  return <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
    {quote.feeTotal > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Fee {part.method}</span><span>{rp(quote.feeTotal)}</span></div>}
    <div style={{ display: "flex", justifyContent: "space-between" }}><span>Diterima {part.method}</span><span>{rp(quote.total)}</span></div>
  </div>;
}
