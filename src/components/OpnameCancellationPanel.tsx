import { batalPerintah } from "@/app/(app)/pos/opname/actions";
import { ActivityHistoryLink } from "./ActivityHistoryLink";
import { SubmitButton } from "./SubmitButton";
import type { OpnameCancellation } from "@/lib/opname-cancellation";
export function OpnameCancellationPanel({ order, blockedReason, cashier = false }: {
  order: OpnameCancellation; blockedReason: string | null; cashier?: boolean;
}) {
  if (order.status === "Batal") return <div className="crm-sec" role="status">
    <h3 style={{fontSize:14}}>Opname dibatalkan</h3>
    <p>{order.cancel_reason}</p>
    <p style={{fontSize:12,color:"var(--tm)"}}>Dibatalkan oleh {order.cancelled_by_name ?? "petugas terdaftar"}{order.cancelled_at && <> pada {new Date(order.cancelled_at).toLocaleString("id-ID", {timeZone:"Asia/Jakarta"})} WIB</>}.</p>
    <p style={{fontSize:12}}>Perintah dan lingkup tetap tersimpan sebagai riwayat. Tidak ada penyesuaian stok atau jurnal dari pembatalan ini.</p>
    <ActivityHistoryLink entity="opname_orders" id={order.id}/>
  </div>;
  if (order.status !== "Terbuka") return null;
  return <div className="crm-sec">
    <h3 style={{fontSize:14}}>Batalkan draf</h3>
    {blockedReason ? <p role="status">{blockedReason}</p> : <>
      <p style={{fontSize:12,color:"var(--tm)"}}>Hanya draf tanpa hitungan terkunci, hasil, atau efek stok/jurnal yang dapat dibatalkan. Server memeriksa kembali; riwayat tetap tersimpan.</p>
      <form action={batalPerintah} style={{display:"grid",gap:10,maxWidth:620}}>
        <input type="hidden" name="order_id" value={order.id}/>
        <input type="hidden" name="kembali" value={cashier ? "kasir" : "pos"}/>
        <label className="flab">Alasan pembatalan<textarea className="fi" name="reason" required minLength={3} maxLength={500} rows={2} style={{display:"block",width:"100%",marginTop:6}}/></label>
        <SubmitButton className="btn-def" pendingText="Membatalkan…">Batalkan draf</SubmitButton>
      </form>
    </>}
  </div>;
}
