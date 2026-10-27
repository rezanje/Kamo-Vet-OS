import { randomUUID } from "node:crypto";
import { NumberInput } from "@/components/NumberInput";
import { evidenceTotals, type HandoffEvidence, type HandoffPrescription } from "@/lib/inpatient-handoff";
import { batalkanBuktiObatBiasa, catatBuktiObatBiasa } from "./rx-evidence-actions";

const KIND_LABEL: Record<HandoffEvidence["kind"], string> = { handover: "Penyerahan", administration: "Pemberian" };
const wib = (value: string | null) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? `${new Date(time).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : "Waktu tidak tersedia";
};
const qty = (value: number | string) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(Number(value));

/**
 * Per-prescription evidence for ONE regular drug (prescription_items.id). Handover and administration
 * are separate records; billing/payment are never used as evidence. Forms render only when the page
 * passed the inpatient record id, the stay is still active and the evidence read was complete.
 */
export function ObatBiasaEvidence({ rx, evidence, recordId, active }: {
  rx: HandoffPrescription; evidence: readonly HandoffEvidence[] | null; recordId?: string; active?: boolean;
}) {
  if (evidence === null) {
    return <div data-rx-evidence={rx.id}><p role="alert" style={{ fontSize: 12 }}>Bukti penyerahan/pemberian {rx.nama_obat} belum dapat dimuat lengkap. Jangan menyimpulkan obat belum diserahkan atau diberikan.</p></div>;
  }
  const rows = evidence.filter((row) => row.prescription_item_id === rx.id);
  const totals = evidenceTotals(evidence, rx.id);
  const unit = rx.satuan ?? "";
  const canWrite = Boolean(recordId) && active === true;
  const remainingHandover = Math.max(0, Math.round((rx.qty - totals.handedOver) * 1000) / 1000);
  const remainingAdministration = Math.max(0, Math.round((rx.qty - totals.administered) * 1000) / 1000);
  return (
    <article data-rx-evidence={rx.id} style={{ border: "1px solid var(--bd)", borderRadius: 7, padding: 10, marginTop: 8 }}>
      <b>{rx.nama_obat}</b> · resep {rx.qty} {unit}
      <p style={{ fontSize: 12, margin: "4px 0" }}>Diserahkan {qty(totals.handedOver)} · Diberikan {qty(totals.administered)} dari {rx.qty} {unit}. Status faktur tidak dipakai sebagai bukti.</p>
      {rows.length ? (
        <ul style={{ fontSize: 12, paddingLeft: 18 }}>
          {rows.map((row) => (
            <li key={row.id} data-evidence-id={row.id} style={row.voided_at ? { color: "var(--tm)" } : undefined}>
              <span style={row.voided_at ? { textDecoration: "line-through" } : undefined}>
                {KIND_LABEL[row.kind] ?? "Jenis tidak dikenali"} {qty(row.qty)} {row.unit ?? unit} · {wib(row.occurred_at)} · dicatat {row.recorded_by_name ?? "nama tidak tersedia"}{row.note ? ` · ${row.note}` : ""}
              </span>
              {row.voided_at && <div>Dibatalkan {wib(row.voided_at)} oleh {row.voided_by_name ?? "nama tidak tersedia"}: {row.void_reason}</div>}
              {canWrite && !row.voided_at && (
                <form action={batalkanBuktiObatBiasa} style={{ display: "inline-flex", gap: 4, marginLeft: 6 }}>
                  <input type="hidden" name="recordId" value={recordId} />
                  <input type="hidden" name="evidenceId" value={row.id} />
                  <input name="reason" required minLength={3} maxLength={500} placeholder="Alasan batal" aria-label={`Alasan membatalkan ${KIND_LABEL[row.kind]} ${rx.nama_obat}`} />
                  <button type="submit" className="back-btn">Batalkan</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : <p style={{ fontSize: 12 }}>Belum ada bukti penyerahan atau pemberian untuk resep ini.</p>}
      {canWrite ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["handover", "administration"] as const).map((kind) => {
            const max = kind === "handover" ? remainingHandover : remainingAdministration;
            return (
              <form key={kind} action={catatBuktiObatBiasa} style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "flex-end" }}>
                <input type="hidden" name="recordId" value={recordId} />
                <input type="hidden" name="prescriptionItemId" value={rx.id} />
                <input type="hidden" name="kind" value={kind} />
                {/* One key per rendered form: a double submit replays the same key and the RPC returns the first record. */}
                <input type="hidden" name="requestKey" value={randomUUID()} />
                <label style={{ fontSize: 11 }}>Jumlah {kind === "handover" ? "diserahkan" : "diberikan"} ({unit || "satuan resep"})
                  <NumberInput name="qty" type="number" inputMode="decimal" min="0.001" step="0.001" max={max} required disabled={max <= 0} />
                </label>
                <label style={{ fontSize: 11 }}>Waktu (kosong = sekarang)<input name="occurredAt" type="datetime-local" /></label>
                <label style={{ fontSize: 11 }}>Catatan<input name="note" maxLength={1000} /></label>
                <button type="submit" className="back-btn" disabled={max <= 0}>Catat {KIND_LABEL[kind].toLowerCase()}</button>
              </form>
            );
          })}
        </div>
      ) : (
        <p style={{ fontSize: 11, color: "var(--tm)" }}>{recordId ? "Rawat inap sudah ditutup; bukti baru tidak dapat dicatat." : "Pencatatan bukti belum diaktifkan pada halaman ini."}</p>
      )}
    </article>
  );
}
