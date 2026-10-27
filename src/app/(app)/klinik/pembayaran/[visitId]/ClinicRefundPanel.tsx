import { ClinicRefundForm, type ClinicRefundRow } from "./ClinicRefundForm";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });

type Line = { id: string; deskripsi: string; qty: number; harga: number; jenis: string | null; item_id: string | null; diskon_persen: number | null; compound_recipe_id: string | null; satuan: string | null };
type Refund = { id: string; no_refund: string; tanggal: string; total: number; method: string; point_delta: number; keterangan: string | null;
  clinic_refund_items: { invoice_item_id: string; deskripsi: string; qty: number; amount: number; kondisi: string | null; restock: boolean }[] | null };
type Request = { id: string; status: string; quoted_total: number; method: string; requested_date: string; refund_no: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
export type ClinicRefundData = { refunds: Refund[]; requests: Request[]; eligible: boolean; reason: string | null };

/** Read once in the page. Before the J03 database step the tables/RPCs do not exist: null hides the panel. */
export async function loadClinicRefundData(db: AnyClient, invoiceId: string): Promise<ClinicRefundData | null> {
  try {
    const [refunds, requests, preview] = await Promise.all([
      db.from("clinic_refunds").select("id,no_refund,tanggal,total,method,point_delta,keterangan,clinic_refund_items(invoice_item_id,deskripsi,qty,amount,kondisi,restock)").eq("invoice_id", invoiceId).order("created_at"),
      db.rpc("get_clinic_refund_requests", { p_invoice: invoiceId, p_office: false, p_status: "", p_offset: 0 }),
      db.rpc("preview_clinic_refund_source", { p_invoice: invoiceId }),
    ]);
    if (!refunds || !requests || refunds.error || requests.error || !Array.isArray(refunds.data) || !Array.isArray(requests.data)) return null;
    return { refunds: refunds.data, requests: requests.data, eligible: !preview?.error && preview?.data?.eligible === true,
      reason: preview?.error ? null : (preview?.data?.reason ?? null) };
  } catch { return null; }
}

/** J03: refund per baris invoice klinik — riwayat refund, permintaan transfer, dan form baru. */
export function ClinicRefundPanel({ visitId, invoice, lines, userId, message, data }: {
  visitId: string; invoice: { id: string; subtotal: number; total: number }; lines: Line[]; userId?: string; message?: string; data: ClinicRefundData;
}) {
  const refunds = { data: data.refunds };
  const requests = { data: data.requests };
  const done = (refunds.data ?? []) as Refund[];
  const open = ((requests.data ?? []) as Request[]).filter((r) => r.status === "pending" || r.status === "diproses");
  const refunded = new Map<string, number>();
  for (const r of done) for (const it of r.clinic_refund_items ?? []) refunded.set(it.invoice_item_id, (refunded.get(it.invoice_item_id) ?? 0) + Number(it.qty));
  const ratio = Number(invoice.subtotal) > 0 ? Number(invoice.total) / Number(invoice.subtotal) : 1;
  const rows: ClinicRefundRow[] = lines.map((l) => ({
    id: l.id, deskripsi: l.deskripsi, satuan: l.satuan, qty: Number(l.qty),
    sisa: Math.max(0, Number(l.qty) - (refunded.get(l.id) ?? 0)),
    restock: l.jenis === "obat" && !!l.item_id && !l.compound_recipe_id,
    nilaiUnit: Math.round(Number(l.harga) * (1 - Number(l.diskon_persen ?? 0) / 100) * ratio * 100) / 100,
  }));
  const totalRefund = done.reduce((a, r) => a + Number(r.total), 0);
  const eligible = data.eligible;
  const sisaAda = rows.some((r) => r.sisa > 0);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-hd"><span><i className="ti ti-arrow-back-up" /> Refund invoice</span>
        {totalRefund > 0 && <span style={{ fontSize: 11 }}>Sudah direfund {rp(totalRefund)} dari {rp(invoice.total)}</span>}</div>
      {message && <div className="p2ban" role="status">{message}</div>}
      {done.length > 0 && <table className="tbl">
        <thead><tr><th>No. refund</th><th>Tanggal</th><th>Rincian</th><th>Cara</th><th style={{ textAlign: "right" }}>Nilai</th></tr></thead>
        <tbody>{done.map((r) => <tr key={r.id}>
          <td>{r.no_refund}</td><td>{r.tanggal}</td>
          <td>{(r.clinic_refund_items ?? []).map((it) => `${it.qty}× ${it.deskripsi}${it.restock ? " (kembali ke stok)" : it.kondisi === "rusak" ? " (tidak layak jual)" : ""}`).join(", ")}
            {r.point_delta < 0 && <div style={{ fontSize: 10 }}>Poin dikurangi {-r.point_delta}</div>}{r.keterangan && <div style={{ fontSize: 10 }}>{r.keterangan}</div>}</td>
          <td>{r.method}</td><td style={{ textAlign: "right" }}>{rp(r.total)}</td></tr>)}</tbody>
      </table>}
      {open.length > 0 && <div className="p2ban" style={{ marginTop: 8 }}>
        Permintaan refund transfer belum selesai: {open.map((r) => `${r.status} ${rp(r.quoted_total)} (${r.requested_date})`).join("; ")}. Jangan ajukan ulang atau bayar tunai untuk barang yang sama.
      </div>}
      {!sisaAda ? <p style={{ fontSize: 11 }}>Semua baris invoice ini sudah direfund.</p>
        : !eligible ? <p style={{ fontSize: 11 }}>Invoice ini belum bisa direfund: {data.reason ?? "status invoice belum dapat diperiksa"}.</p>
        : <details style={{ marginTop: 8 }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>Buat refund baru</summary>
          <ClinicRefundForm visitId={visitId} invoiceId={invoice.id} rows={rows} userId={userId} />
        </details>}
    </div>
  );
}
