import Link from "next/link";
import { hitungSaldoUangMuka, labelStatusRefund, type RefundUangMuka } from "@/lib/uang-muka-refund";
import { UangMukaRefundForm } from "./koreksi/UangMukaRefundForm";

const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
type Adv = { id: string; no_uang_muka: string; amount: number; applied: number; status: string; refunded_amount?: number | null; refund_reserved?: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Panel "Kembalikan saldo uang muka" (hanya OWNER/FINANCE). Dipakai di halaman koreksi Owner dan halaman pembayaran. Menampilkan saldo tiap uang muka,
 *  form pengajuan, dan pengajuan yang menunggu dengan tautan "Selesaikan" ke antrean refund Finance. Tidak ada uang yang bergerak dari sini. */
export async function UangMukaRefundSection({ db, visitId, role, requestKeyBase }: { db: AnyClient; visitId: string; role: string | null | undefined; requestKeyBase: string }) {
  if (role !== "OWNER" && role !== "FINANCE") return null;
  const { data, error } = await db.from("clinic_customer_advances").select("id,no_uang_muka,amount,applied,status,refunded_amount,refund_reserved").eq("visit_id", visitId).order("created_at");
  const judul = <div className="card-hd"><span><i className="ti ti-cash-banknote" /> Kembalikan saldo uang muka</span></div>;
  if (error || !Array.isArray(data)) return <div className="card" style={{ marginTop: 12 }}>{judul}<p className="p2ban" role="alert">Saldo uang muka belum dapat dimuat. Muat ulang halaman.</p></div>;
  const advances = (data as Adv[]).filter((a) => a.status === "aktif");
  if (advances.length === 0) return null;
  const rows = await Promise.all(advances.map(async (a) => {
    const res = await db.rpc("get_clinic_advance_refunds", { p_advance: a.id, p_office: false, p_status: "", p_offset: 0 });
    return { adv: a, refunds: (!res?.error && Array.isArray(res?.data) ? res.data : []) as RefundUangMuka[], readable: !res?.error && Array.isArray(res?.data) };
  }));
  return <div className="card" style={{ marginTop: 12 }}>
    {judul}
    {rows.map(({ adv, refunds, readable }) => {
      const saldo = hitungSaldoUangMuka(adv);
      const kembali = Number(adv.refunded_amount ?? 0);
      return <div key={adv.id} style={{ marginBottom: 10 }}>
        {kembali > 0 && <p style={{ fontSize: 11 }} role="note">Dari uang muka {adv.no_uang_muka} sudah dikembalikan {rp(kembali)}. Kwitansinya tidak bisa dibatalkan lagi; kembalikan sisanya lewat panel ini.</p>}
        {saldo > 0
          ? <UangMukaRefundForm advanceId={adv.id} noUangMuka={adv.no_uang_muka} saldo={saldo} requestKey={`${requestKeyBase}-${adv.id}`} />
          : <p style={{ fontSize: 11 }}>Uang muka {adv.no_uang_muka}: tidak ada saldo yang belum terpakai untuk dikembalikan.</p>}
        {!readable && <p className="p2ban" role="alert">Daftar pengajuan belum dapat dimuat.</p>}
        {refunds.length > 0 && <table className="tbl" style={{ marginTop: 6 }}>
          <thead><tr><th>No.</th><th>Status</th><th style={{ textAlign: "right" }}>Jumlah</th><th>Tujuan / bukti</th><th /></tr></thead>
          <tbody>{refunds.map((r) => <tr key={r.id}>
            <td>{r.no_refund}</td><td>{labelStatusRefund(r.status)}</td><td style={{ textAlign: "right" }}>{rp(r.amount)}</td>
            <td style={{ fontSize: 10.5 }}>{r.destination ? `${r.destination.bank} · ${r.destination.account} · ${r.destination.name}` : ""}{r.status === "selesai" && r.bank_reference ? ` · bukti ${r.bank_reference} (${r.tanggal ?? ""})` : ""}</td>
            <td>{(r.status === "pending" || r.status === "diproses") && <Link className="btn-def" href="/kas-bank/refund?status=pending">Selesaikan</Link>}</td>
          </tr>)}</tbody>
        </table>}
      </div>;
    })}
  </div>;
}
