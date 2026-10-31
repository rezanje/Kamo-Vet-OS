import type { ClinicCorrectablePart } from "@/lib/clinic-payment-correction";
import { ClinicPaymentCorrectionForm } from "./ClinicPaymentCorrectionForm";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export type ClinicPaymentCorrectionRow = {
  id: string; revision: number; amount: number; from_method: string; to_method: string; reason: string; created_at: string;
};

/** J02 klinik (Owner/Finance): riwayat dan form koreksi Tunai <-> Transfer pada invoice yang sama. */
export function ClinicPaymentCorrectionPanel({ userId, visitId, invoiceId, parts, history, readError, blocked }: {
  userId: string; visitId: string; invoiceId: string; parts: ClinicCorrectablePart[];
  history: ClinicPaymentCorrectionRow[]; readError: boolean; blocked: string | null;
}) {
  return <details className="card" style={{ marginTop: 12 }}>
    <summary style={{ fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
      <i className="ti ti-arrows-exchange" /> KOREKSI METODE PEMBAYARAN (TUNAI ↔ TRANSFER)
    </summary>
    <div style={{ fontSize: 10.5, color: "var(--tm)", margin: "6px 0" }}>
      Nominal dan struk tidak berubah. Sistem mencatat jurnal koreksi hari ini dari rekening lama ke rekening metode baru.
      Shift yang sudah ditutup tidak dibuka ulang.
    </div>
    {readError ? <p role="alert">Riwayat koreksi belum dapat dibaca. Muat ulang sebelum mengoreksi.</p> : <>
      {history.length > 0 && <div style={{ marginBottom: 6 }}>
        {history.map((h) => <div key={h.id} style={{ fontSize: 11, borderBottom: ".5px solid var(--bd)", padding: "5px 0" }}>
          <b>Revisi {h.revision}</b> · {fmt(h.created_at)} · {h.from_method} → {h.to_method} {rp(h.amount)}
          <div style={{ color: "var(--tm)" }}>Alasan: {h.reason}</div>
        </div>)}
      </div>}
      {blocked ? <p role="status" style={{ fontSize: 11 }}>{blocked}</p>
        : parts.length === 0 ? <p role="status" style={{ fontSize: 11 }}>Tidak ada bagian pembayaran Tunai atau Transfer yang dapat dikoreksi.</p>
        : parts.map((part) => <ClinicPaymentCorrectionForm key={`${part.paymentId ?? "langsung"}:${history.length}`} userId={userId}
          visitId={visitId} invoiceId={invoiceId} paymentId={part.paymentId} revision={history.length}
          label={part.label} method={part.method} amount={part.amount} />)}
    </>}
  </details>;
}
