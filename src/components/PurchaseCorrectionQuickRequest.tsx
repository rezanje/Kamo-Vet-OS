import { ajukanKoreksiPembelian } from "@/app/(app)/pembelian/koreksi/actions";
import type { CorrectionSourceKind } from "@/lib/purchase-correction-requests";

/**
 * P01: form ringkas "Minta koreksi" untuk layar di luar modul Pembelian yang tetap
 * menampilkan dokumen pembelian (mis. Hutang untuk FINANCE). Sama dengan panel di
 * halaman dokumen: hanya mengantre untuk Super Admin, tidak mengubah transaksi apa pun.
 */
export function PurchaseCorrectionQuickRequest({ kind, sourceId, label, back, requestKey }: {
  kind: CorrectionSourceKind; sourceId: string; label: string; back: string; requestKey: string;
}) {
  return <details>
    <summary className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
      Minta koreksi
    </summary>
    <form action={ajukanKoreksiPembelian} style={{ display: "grid", gap: 6, marginTop: 6, minWidth: 260 }}>
      <input type="hidden" name="source_kind" value={kind} />
      <input type="hidden" name="source_id" value={sourceId} />
      <input type="hidden" name="request_key" value={requestKey} />
      <input type="hidden" name="back" value={back} />
      <textarea className="fi" name="detail" required minLength={10} maxLength={2000} rows={3} aria-label={`Rincian koreksi ${label}`}
        placeholder="Bagian yang salah, nilai yang seharusnya, dan buktinya" />
      <span style={{ fontSize: 10, color: "var(--tm)" }}>Masuk antrean Super Admin. Faktur dan pembayaran tidak berubah.</span>
      <button type="submit" className="btn-acc" style={{ justifySelf: "start", padding: "4px 10px", fontSize: 10.5 }}>Kirim permintaan</button>
    </form>
  </details>;
}
