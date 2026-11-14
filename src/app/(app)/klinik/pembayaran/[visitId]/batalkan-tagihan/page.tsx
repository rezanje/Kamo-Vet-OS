import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pesanBatalTagihan, ringkasanPratinjauBatalTagihan, type PratinjauBatalTagihan } from "@/lib/batal-tagihan-klinik";
import { UangMukaRefundSection } from "../UangMukaRefundSection";
import { BatalTagihanForm } from "./BatalTagihanForm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** B2 "Batalkan tagihan" klinik (Owner / peran berizin). Halaman terpisah: kasir dan PembayaranForm tidak disentuh. */
export default async function BatalTagihanPage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ invoice_id?: string }> }) {
  const { visitId } = await params; const { invoice_id: invoiceId } = await searchParams;
  if (!uuid.test(visitId) || !invoiceId || !uuid.test(invoiceId)) notFound();
  const db = await createClient();
  const kembali = `/klinik/pembayaran/${visitId}`;
  const halamanIni = `/klinik/pembayaran/${visitId}/batalkan-tagihan?invoice_id=${invoiceId}`;
  const back = <div style={{ marginBottom: 8 }}><Link href={kembali} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link></div>;
  const [{ data, error }, { data: { user } }] = await Promise.all([
    db.rpc("clinic_void_invoice_preview", { p_invoice_id: invoiceId }),
    db.auth.getUser(),
  ]);
  const { data: profil } = user ? await db.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };
  // DP tagihan yang sudah dibatalkan menjadi saldo uang muka kunjungan ini: dikembalikan dari panel yang sudah ada (Owner/Finance).
  const panelUangMuka = <UangMukaRefundSection db={db} visitId={visitId} role={(profil as { role?: string } | null)?.role} requestKeyBase={`batal-tagihan-${invoiceId}`} />;
  if (error || !data) return <>{back}<div className="p2ban" role="alert">{pesanBatalTagihan(error?.message)}</div></>;
  const p = data as PratinjauBatalTagihan;
  if (p.invoice.visit_id !== visitId) notFound();
  const judul = <h1 style={{ fontSize: 16, margin: "4px 0 10px" }}>Batalkan tagihan {p.invoice.no ?? ""}</h1>;
  if (p.refuse) return <>{back}{judul}<div className="p2ban" role="alert">{p.refuse.message}</div>{p.refuse.code === "SUDAH_BATAL" && panelUangMuka}</>;
  return <>
    {back}
    {judul}
    <BatalTagihanForm key={invoiceId} visitId={visitId} invoiceId={invoiceId} invoiceNo={String(p.invoice.no ?? "")}
      ringkasan={ringkasanPratinjauBatalTagihan(p)} requestKey={randomUUID()} kembaliHref={kembali} halamanIni={halamanIni} />
  </>;
}
