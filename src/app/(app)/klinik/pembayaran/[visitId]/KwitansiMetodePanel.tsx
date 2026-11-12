import type { MetodeBayar } from "@/lib/metode-bayar";
import { KwitansiMetodeForm } from "./KwitansiMetodeForm";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export type KwitansiBagian = { id: string; urutan: number; metode: MetodeBayar; amount: number };
export type KwitansiAktif = { id: string; no: string; tanggal: string; shiftClosed: boolean; parts: KwitansiBagian[] };
export type KwitansiMetodeRiwayat = { id: string; receipt_id: string; revision: number; amount: number; from_method: string; to_method: string; reason: string; created_at: string };

/** Ubah metode bayar kwitansi (Owner, Finance, atau peran dengan izin "Ubah metode bayar"): rawat inap, pelunasan, uang muka. */
export function KwitansiMetodePanel({ userId, visitId, receipts, history, readError }: {
  userId: string; visitId: string; receipts: KwitansiAktif[]; history: KwitansiMetodeRiwayat[]; readError: boolean;
}) {
  return <details className="card" style={{ marginTop: 12 }}>
    <summary style={{ fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
      <i className="ti ti-arrows-exchange" /> UBAH METODE BAYAR KWITANSI (rawat inap, pelunasan, uang muka)
    </summary>
    <div style={{ fontSize: 10.5, color: "var(--tm)", margin: "6px 0" }}>
      Untuk salah pilih metode, misalnya uang diterima lewat QRIS tetapi kasir memilih Tunai. Nomor kwitansi dan tagihan tetap, nominal tidak berubah,
      stok/poin/komisi tidak tersentuh. Sistem mencatat jurnal koreksi bertanggal HARI INI dari rekening lama ke rekening metode baru
      (bila rekeningnya sama, hanya label metode yang berubah) dan menyimpan alasan serta nama Anda. Tunai ↔ non-tunai menggeser hitungan laci shift kasir yang menerima uang itu.
      Kwitansi yang sudah dibatalkan tidak bisa diubah; kalau perlu mengubah banyak hal, pakai Batalkan penerimaan lalu terima ulang.
    </div>
    {readError ? <p role="alert">Data kwitansi belum dapat dibaca. Muat ulang sebelum mengubah.</p> : <>
      {history.length > 0 && <div style={{ marginBottom: 6 }}>
        {history.map((h) => <div key={h.id} style={{ fontSize: 11, borderBottom: ".5px solid var(--bd)", padding: "5px 0" }}>
          <b>Revisi {h.revision}</b> · {fmt(h.created_at)} · {h.from_method} → {h.to_method} {rp(h.amount)}
          <div style={{ color: "var(--tm)" }}>Alasan: {h.reason}</div>
        </div>)}
      </div>}
      {receipts.length === 0 ? <p role="status" style={{ fontSize: 11 }}>Tidak ada kwitansi aktif pada kunjungan ini.</p>
        : receipts.flatMap((r) => r.parts.map((part) => <KwitansiMetodeForm key={`${part.id}:${history.filter(h => h.receipt_id === r.id).length}`}
          userId={userId} visitId={visitId} receiptId={r.id} receiptNo={r.no} partId={part.id}
          revision={history.filter(h => h.receipt_id === r.id).length} method={part.metode} amount={part.amount} shiftClosed={r.shiftClosed} />))}
    </>}
  </details>;
}
