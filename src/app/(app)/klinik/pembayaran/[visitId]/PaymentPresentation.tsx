"use client";
import type { ReactNode } from "react";
import { NumberInput } from "@/components/NumberInput";
import { METODE_BAYAR } from "@/lib/metode-bayar";
import { METODE_BAYAR as SPLIT_METHODS } from "@/lib/kas-akun";
import type { SplitPaymentDraft } from "@/lib/clinic-split-payment";
import styles from "./PembayaranForm.module.css";
export type PaymentPatient = { photo: string | null; name: string; species: string; owner: string; phone: string; address: string; dokter: string; jenisLayanan: string; noInvoice: string; tanggal: string };
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
// Extracted from PembayaranForm: presentation only, never posts or computes a quote.
export function PaymentPatientHeader({patient}: {patient: PaymentPatient}) { return (
      <div className="card" style={{ marginBottom: 14, padding: 18 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div style={{ width: 96, height: 96, borderRadius: 12, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
            {patient.photo ? <img src={patient.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <i className="ti ti-paw" style={{ fontSize: 40, color: "var(--td)" }} />}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 19, fontWeight: 800, color: "var(--sb)" }}>{patient.name}</span>
              <span className="bge b">{patient.species}</span>
            </div>
            <Pair label="Pemilik" value={patient.owner} />
            <Pair label="No. HP" value={patient.phone} />
            <Pair label="Alamat" value={patient.address} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Pair label="No. Invoice" value={patient.noInvoice} />
            <Pair label="Tanggal" value={patient.tanggal} />
            <Pair label="Dokter" value={patient.dokter} />
            <Pair label="Jenis Layanan" value={patient.jenisLayanan} />
          </div>
        </div>
      </div>
); }

export function PaymentLayout({ cart, chargeSummary, catatanResep, paymentPanel, afterSummary }: { cart: ReactNode; chargeSummary: ReactNode; catatanResep: string | null; paymentPanel: ReactNode; afterSummary?: ReactNode }) {
  return <div className={styles.layout} style={{ display: "grid", gap: 14, alignItems: "start" }}>
    <div className="crm-sec" style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--posb)", letterSpacing: ".02em", marginBottom: 12, borderBottom: "2px solid var(--posb)", paddingBottom: 8, display: "inline-block" }}>
        <i className="ti ti-clipboard-list" /> RINCIAN TAGIHAN
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--sb)", letterSpacing: ".03em", marginBottom: 10 }}>RINCIAN LAYANAN DAN OBAT</div>
      {cart}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
        <div style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--posb)", marginBottom: 4 }}>CATATAN RESEP</div>
          <div style={{ fontSize: 11, color: "var(--tm)", lineHeight: 1.5 }}>{catatanResep || "—"}</div>
        </div>
        <div>{chargeSummary}</div>
      </div>
      {afterSummary}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{paymentPanel}</div>
  </div>;
}
export function PaymentChargeTotal({ total }: { total: number }) {
 return <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1.5px solid var(--bd)" }}>
   <span style={{ fontSize: 13, fontWeight: 800, color: "var(--sb)" }}>TOTAL TAGIHAN</span>
   <span style={{ fontSize: 17, fontWeight: 800, color: "var(--posb)" }}>{rp(total)}</span>
 </div>;
}
export function PaymentCashierHeader({name, historical = false, historicalName = ""}: {name: string; historical?: boolean; historicalName?: string}) {
 return <div className="card" style={{ marginBottom: 12 }}>
   <span className="flab">{historical ? "Penjual historis" : "Kasir"}</span>
   <div>{historical ? `${historicalName} · mengikuti invoice tersimpan` : `${name} · akun yang sedang masuk`}</div>
   {historical && <div style={{fontSize:11}}>Kasir: {name}</div>}
 </div>;
}

export function PaymentSummary({ total, totalDiterima, totalDiterimaLabel = "Total Pembayaran", remaining, paidStatus, initialCreditAmount = 0, dpPaid = 0, initialDpDate = null, sisa = remaining, extra }: {
 total: number; totalDiterima: number; totalDiterimaLabel?: string; remaining: number; paidStatus: string; initialCreditAmount?: number; dpPaid?: number; initialDpDate?: string | null; sisa?: number; extra?: ReactNode;
}) {
 const statusColor = paidStatus === "Lunas" ? "#15803d" : paidStatus === "DP" ? "#7c3aed" : "#b91c1c";
 return <>
          {/* Status */}
          <div className="card" style={{ background: paidStatus === "Lunas" ? "#f0fdf4" : "#fff", borderColor: statusColor }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: statusColor, letterSpacing: ".02em" }}>PRATINJAU PEMBAYARAN</span>
              <span className={`bge ${paidStatus === "Lunas" ? "g" : paidStatus === "DP" ? "pu" : "r"}`}>{paidStatus.toUpperCase()}</span>
            </div>
            <p style={{fontSize:11,color:"var(--tm)"}}>Status ini berlaku setelah penyimpanan berhasil; isian ini belum menjadi bukti pembayaran.</p>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Total Tagihan</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--sb)", lineHeight: 1.2 }}>{rp(total)}</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 6 }}>Sisa yang Harus Dibayar</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: statusColor }}>{rp(remaining)}</div>
          </div>

          {/* Ringkasan */}
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--posb)", marginBottom: 8 }}>RINGKASAN PEMBAYARAN</div>
            <SumRow label="Total Tagihan" value={rp(total)} />
            {initialCreditAmount > 0 && <SumRow label="Pembayaran dialihkan" value={rp(initialCreditAmount)} />}
            <SumRow label={totalDiterimaLabel} value={rp(totalDiterima)} />
            {extra}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--bd)" }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>Sisa yang Harus Dibayar</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: statusColor }}>{rp(remaining)}</span>
            </div>
          </div>

          {/* DP */}
          {dpPaid > 0 && (
            <div className="card" style={{ borderColor: "#c4b5fd" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: "#7c3aed" }}>DP PEMBAYARAN</span>
                <span className="bge pu">DP DIBAYAR</span>
              </div>
              <SumRow label="Tanggal DP" value={initialDpDate ?? "—"} />
              <SumRow label="Jumlah DP" value={rp(dpPaid)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--bd)" }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Sisa Setelah DP</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed" }}>{rp(sisa)}</span>
              </div>
            </div>
          )}

 </>;
}

export function PaymentMethodControls({ mixed, onMixed, splitPayments, onSplit, metode, onMethod, bayar, onAmount, bayarManual, editMode = false, splitError = null, methods = METODE_BAYAR.map(option => option.m), splitMethods = SPLIT_METHODS, accountLabel, excessLabel = "Kembalian", kembalian, amountLabel = "Jumlah Bayar", splitCaption = "Satu invoice" }: {
 mixed: boolean; onMixed: (value: boolean) => void; splitPayments: SplitPaymentDraft[]; onSplit: (parts: SplitPaymentDraft[]) => void; metode: string; onMethod: (method: string) => void; bayar: number; onAmount: (amount: number) => void; bayarManual: boolean; editMode?: boolean; splitError?: string | null; methods?: readonly string[]; splitMethods?: readonly string[]; accountLabel?: (method: string) => ReactNode; excessLabel?: string; kembalian: number; amountLabel?: string; splitCaption?: string;
}) {
 const splitAmount = splitPayments.reduce((sum, part) => sum + part.amount, 0);
 return <>
          <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--posb)", marginBottom: 8 }}>PILIH METODE PEMBAYARAN</div>
            {!editMode && <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <input type="checkbox" checked={mixed} onChange={event => onMixed(event.target.checked)} />
              Bayar dengan beberapa metode
            </label>}
            {mixed ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {splitPayments.map((part, index) => <div key={index} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select className="fi" aria-label={`Metode pembayaran ${index + 1}`} value={part.method}
                  onChange={event => onSplit(splitPayments.map((row, i) => i === index ? { ...row, method: event.target.value } : row))}>
                  {splitMethods.map(method => <option key={method}>{method}</option>)}
                </select>
                <NumberInput className="fi" type="number" min={1} step={1} aria-label={`Nominal pembayaran ${index + 1}`} value={part.amount || ""}
                  onChange={event => onSplit(splitPayments.map((row, i) => i === index ? { ...row, amount: Number(event.target.value) } : row))} />
                {splitPayments.length > 2 && <button className="btn-def" type="button" aria-label={`Hapus pembayaran ${index + 1}`}
                  onClick={() => onSplit(splitPayments.filter((_, i) => i !== index))}>×</button>}
                {accountLabel?.(part.method)}
              </div>)}
              <button className="btn-def" type="button" disabled={splitPayments.length >= 6}
                onClick={() => onSplit([...splitPayments, { method: splitMethods[0] ?? "", amount: 0 }])}>Tambah metode pembayaran</button>
              <div style={{ fontSize: 11 }}>{splitCaption} · total bagian {rp(splitAmount)}</div>
              {splitError && <div role="alert" style={{ color: "#b91c1c", fontSize: 11 }}>{splitError}</div>}
            </div> :
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {methods.map(m => {
                const { ic, desc } = METODE_BAYAR.find(option => option.m === m) ?? { ic: "ti-credit-card", desc: "Bayar dengan kartu debit atau kredit" };
                return (
                <button key={m} type="button" aria-label={m} aria-pressed={metode === m} data-payment-method={m} disabled={editMode} onClick={() => onMethod(m)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", textAlign: "left",
                  border: `1.5px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "#eff4ff" : "#fff",
                }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", border: `2px solid ${metode === m ? "var(--posb)" : "var(--bd)"}`, background: metode === m ? "var(--posb)" : "#fff", boxShadow: metode === m ? "inset 0 0 0 2.5px #fff" : "none", flexShrink: 0 }} />
                  <i className={`ti ${ic}`} style={{ fontSize: 18, color: metode === m ? "var(--posb)" : "var(--tm)" }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{m}</div>
                    <div style={{ fontSize: 9.5, color: "var(--tm)" }}>{desc}</div>
                  </div>
                </button>
              ); })}
            </div>}
            {!mixed && accountLabel?.(metode)}
          </div>

          {/* Penerimaan */}
          {!mixed && <div className="card">
            <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--posb)", marginBottom: 8 }}>PENERIMAAN PEMBAYARAN</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, color: "var(--tm)" }}>Jumlah Bayar</span>
              <NumberInput className="fi" type="number" min={0} step={1} disabled={editMode} value={bayar || ""} aria-label={amountLabel} onChange={(e) => onAmount(Number(e.target.value))} style={{ width: 130, textAlign: "right" }} />
              {metode !== "Tunai" && !bayarManual && !editMode && <span style={{ fontSize: 10, color: "var(--tm)" }}>otomatis = sisa tagihan</span>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: "#15803d" }}>{excessLabel}</span>
              <span style={{ fontWeight: 700, color: "#15803d" }}>{rp(kembalian)}</span>
            </div>
          </div>}

 </>;
}
function Pair({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 6, padding: "2px 0", fontSize: 12 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>: {value || "—"}</span>
    </div>
  );
}
export function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  );
}


export function PaymentActions({ print, save, finish }: { print: ReactNode; save: ReactNode; finish?: ReactNode }) {
 return <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 6 }}>{print}{save}{finish}</div>;
}
export function PaymentPrintUnavailable() {
 return <span className="btn-def" title="Simpan invoice dulu sebelum cetak" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 12px", fontSize: 11, opacity: 0.5, cursor: "not-allowed" }}>
   <i className="ti ti-printer" /> Cetak
 </span>;
}

export function PaymentPageHeading() { return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-file-invoice" style={{ fontSize: 22, color: "var(--posb)" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>INVOICE / PEMBAYARAN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Detail tagihan dan metode pembayaran</div>
        </div>
      </div>
); }
