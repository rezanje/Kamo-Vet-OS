import Link from "next/link";
import { ajukanKoreksiPembelian } from "@/app/(app)/pembelian/koreksi/actions";
import {
  CORRECTION_QUEUE_PATH, statusLabel, type CorrectionSourceKind, type PurchaseCorrectionRequest,
} from "@/lib/purchase-correction-requests";

const waktu = (iso: string) => new Date(iso).toLocaleString("id-ID", {
  day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
});

/**
 * Permintaan koreksi yang terikat ke PO/faktur ini. Non-Super Admin mengirim request;
 * Super Admin melihat request yang menunggu dan memprosesnya di antrean.
 * `requests === null` berarti daftar gagal dibaca: jangan tampil sebagai "tidak ada".
 */
export function PurchaseCorrectionRequestPanel({ kind, sourceId, label, owner, requests, requestKey, notice, error }: {
  kind: CorrectionSourceKind; sourceId: string; label: string; owner: boolean;
  requests: PurchaseCorrectionRequest[] | null; requestKey: string; notice?: string; error?: string;
}) {
  const docName = kind === "purchase_order" ? "PO" : "faktur";
  const pending = requests?.filter(row => row.status === "pending").length ?? 0;
  if (owner && requests && requests.length === 0) return null;
  return <section className="crm-sec" id="request-purchase-correction" aria-label={`Permintaan koreksi ${label}`} style={{ scrollMarginTop: 90 }}>
    <h2 style={{ fontSize: 14, marginBottom: 8 }}>{owner ? `Permintaan koreksi ${label}` : `Minta koreksi ${label}`}</h2>
    {notice && <p role="status" className="p2ban" style={{ background: "#e8f5ee", color: "#15803d" }}>{notice}</p>}
    {error && <p role="alert" className="p2ban" style={{ background: "#fef2f2", color: "#b91c1c" }}>{error}</p>}
    {!owner && <>
      <p style={{ fontSize: 11.5 }}>Tulis bagian yang salah (barang, satuan, jumlah, harga, atau pembayaran), nilai yang seharusnya, dan bukti pendukung. Permintaan tersimpan dan masuk antrean Super Admin.</p>
      <p style={{ color: "var(--tm)", fontSize: 11 }}>Mengirim permintaan tidak mengubah {docName} atau transaksi terkait. Super Admin meninjau lalu melakukan koreksi resmi bila perlu.</p>
      {requests !== null && <form action={ajukanKoreksiPembelian} style={{ display: "grid", gap: 8, maxWidth: 640 }}>
        <input type="hidden" name="source_kind" value={kind} />
        <input type="hidden" name="source_id" value={sourceId} />
        <input type="hidden" name="request_key" value={requestKey} />
        <textarea className="fi" name="detail" required minLength={10} maxLength={2000} rows={3} aria-label={`Rincian koreksi ${label}`}
          placeholder="Contoh: baris 2 satuan seharusnya box isi 10, bukan pcs; bukti nota pemasok no. ..." />
        <button type="submit" className="btn-acc" style={{ justifySelf: "start" }}>Kirim permintaan koreksi</button>
      </form>}
    </>}
    {requests === null
      ? <p role="alert" className="p2ban">Status permintaan koreksi belum dapat dimuat. Muat ulang sebelum mengirim permintaan baru.</p>
      : requests.length > 0 && <>
        <h3 style={{ fontSize: 12, margin: "12px 0 6px" }}>{owner ? `${pending} menunggu · ${requests.length} total` : "Permintaan Anda untuk dokumen ini"}</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11 }}>
          {requests.map(row => <li key={row.id} style={{ marginBottom: 6 }}>
            <strong>{statusLabel(row.status)}</strong> · {waktu(row.created_at)} ·{" "}
            <Link href={`${CORRECTION_QUEUE_PATH}${row.status === "selesai" ? "?status=selesai" : ""}#request-${row.id}`}>Lihat di antrean</Link>
            <div style={{ whiteSpace: "pre-wrap" }}>{row.detail}</div>
            {row.status === "selesai" && row.resolution && <div style={{ color: "var(--tm)", whiteSpace: "pre-wrap" }}>Tindak lanjut: {row.resolution}</div>}
          </li>)}
        </ul>
      </>}
  </section>;
}
