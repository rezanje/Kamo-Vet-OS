import { DocumentLink } from "@/components/RelatedDocuments";
import type { ReceiptCancelPreview } from "@/lib/purchase-cancel-preview";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Langkah berikutnya dalam bahasa biasa (urutan Accurate: pembayaran > faktur > penerimaan). Hanya tampilan. */
export function ReceiptCancelPreviewPanel({ preview, error, from }: { preview: ReceiptCancelPreview | null; error: string | null; from: string }) {
  if (!preview) {
    return <div role="note" className="p2ban" style={{ marginTop: 10 }}>
      Pratinjau pembatalan belum dapat dimuat{error ? `: ${error}` : ""}. Tombol batal tetap tersedia; database memeriksa semua syarat dan menolak dengan penjelasan bila belum bisa.
    </div>;
  }
  if (preview.already_cancelled) return null;
  if (preview.can_cancel) {
    return <div role="status" className="p2ban" style={{ marginTop: 10, background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
      <strong>Bisa dibatalkan.</strong> Yang terjadi dalam satu langkah: stok berkurang{preview.effects.stock?.length ? ` (${preview.effects.stock.map(s => `${s.nama} ${s.qty}`).join(", ")})` : ""},
      jurnal persediaan{preview.effects.total ? ` ${rp(preview.effects.total)}` : ""} dibalik, jumlah diterima di PO dibuka lagi. Setelah itu PO bisa diubah dan barang diterima ulang. Dokumen asli tetap tersimpan.
    </div>;
  }
  return <div role="alert" className="p2ban" style={{ marginTop: 10, background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
    <strong>Belum bisa dibatalkan. Lakukan dulu:</strong>
    <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
      {preview.blockers.map((b, i) => <li key={`${b.code}:${i}`} style={{ marginBottom: 6 }}>
        <span>{b.message}</span>
        {b.docs.length > 0 && <span> {b.docs.map((d, j) => <span key={`${d.kind}:${d.id}`}>{j > 0 && ", "}<DocumentLink kind={d.kind} id={d.id} from={from}>{d.label}</DocumentLink></span>)}</span>}
        {b.items && b.items.length > 0 && <ul style={{ margin: "4px 0 0 16px" }}>
          {b.items.map(it => <li key={it.item_id}>{it.nama}: diterima {it.qty_diterima}, masih utuh {it.qty_masih_utuh}, terpakai {it.qty_terpakai}</li>)}
        </ul>}
        {b.keluar && b.keluar.length > 0 && <div style={{ fontSize: 11, marginTop: 4 }}>
          Pengeluaran barang sesudah penerimaan: {b.keluar.map(k => `${k.source_ref || k.source} (${k.qty}${k.tanggal ? `, ${k.tanggal}` : ""})`).join("; ")}
        </div>}
      </li>)}
    </ol>
  </div>;
}
