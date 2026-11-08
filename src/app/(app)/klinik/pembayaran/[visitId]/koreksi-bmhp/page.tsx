import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadClinicPaymentMaster } from "@/lib/clinic-payment";
import { pesanBmhpOwner, type KomponenBmhp } from "@/lib/bmhp-owner";
import { BmhpOwnerForm } from "../BmhpOwnerForm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rp = (n: number) => "Rp " + Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
type BarisBmhp = { invoice_item_id: string; deskripsi: string; qty: number; harga: number; hpp: number; bmhp: { components?: KomponenBmhp[] } | null;
  history: { created_at: string; actor_name: string | null; reason: string; hpp_before: number; hpp_after: number }[] };

/** Ubah BMHP baris tindakan yang SUDAH ditagih (rawat inap, lunas atau belum; hanya Owner). Halaman terpisah: kasir tidak disentuh. */
export default async function KoreksiBmhpTagihanPage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ invoice_id?: string }> }) {
  const { visitId } = await params; const { invoice_id: invoiceId } = await searchParams;
  if (!uuid.test(visitId) || !invoiceId || !uuid.test(invoiceId)) notFound();
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: profil } = user ? await db.from("profiles").select("role,is_active,branch_id").eq("id", user.id).maybeSingle() : { data: null };
  const back = <div style={{ marginBottom: 8 }}><Link href={`/klinik/pembayaran/${visitId}?invoice_id=${invoiceId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link></div>;
  if (!profil || profil.role !== "OWNER" || profil.is_active !== true) return <>{back}<div className="p2ban" role="alert">{pesanBmhpOwner("ACCESS_DENIED: x")}</div></>;
  const { data, error } = await db.rpc("clinic_owner_invoice_bmhp_lines", { p_invoice_id: invoiceId });
  if (error || !data) return <>{back}<div className="p2ban" role="alert">{pesanBmhpOwner(error?.message)}</div></>;
  const master = await loadClinicPaymentMaster(db, (profil as { branch_id?: string | null }).branch_id ?? null);
  const bahan = master.obat.filter((item) => !item.paket).map((item) => ({ id: item.id, name: item.name, unit: item.unit }));
  const lines = (Array.isArray(data.lines) ? data.lines : []) as BarisBmhp[];
  return <>
    {back}
    <h1 style={{ fontSize: 16, margin: "4px 0 10px" }}>Ubah BMHP tindakan pada tagihan {data.invoice_no} ({data.paid_status})</h1>
    {data.voided && <div className="p2ban" role="alert">{pesanBmhpOwner("INVOICE_VOID: x")}</div>}
    {lines.length === 0 && <div className="card">Tagihan ini tidak punya baris tindakan ber-BMHP.</div>}
    {lines.map((line) => <div key={line.invoice_item_id} className="card" style={{ marginBottom: 10 }}>
      <b>{line.deskripsi}</b> · harga {rp(line.harga)} · HPP {rp(line.hpp)}
      <BmhpOwnerForm mode="tagihan" visitId={visitId} targetId={line.invoice_item_id} title={line.deskripsi} price={line.harga} components={line.bmhp?.components ?? []} master={bahan} requestKey={randomUUID()} />
      {line.history.length > 0 && <details style={{ marginTop: 6 }}><summary>Riwayat perubahan ({line.history.length})</summary>
        {line.history.map((h, i) => <div key={i} style={{ fontSize: 11 }}>{new Date(h.created_at).toLocaleString("id-ID")} · {h.actor_name ?? "-"} · HPP {rp(h.hpp_before)} → {rp(h.hpp_after)} · {h.reason}</div>)}
      </details>}
    </div>)}
  </>;
}
