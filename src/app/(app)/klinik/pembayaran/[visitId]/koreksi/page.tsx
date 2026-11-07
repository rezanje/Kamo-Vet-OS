import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pesanTarikBaris, type BarisTarik } from "@/lib/tarik-baris-pesan";
import { TarikBarisForm } from "./TarikBarisForm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tarik baris dari tagihan RANAP yang sudah lunas (hanya Owner). Halaman terpisah: kasir/PembayaranForm tidak disentuh. */
export default async function KoreksiTagihanLunasPage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ invoice_id?: string }> }) {
  const { visitId } = await params; const { invoice_id: invoiceId } = await searchParams;
  if (!uuid.test(visitId) || !invoiceId || !uuid.test(invoiceId)) notFound();
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: profil } = user ? await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle() : { data: null };
  const back = <div style={{ marginBottom: 8 }}><Link href={`/klinik/pembayaran/${visitId}?invoice_id=${invoiceId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link></div>;
  if (!profil || profil.role !== "OWNER" || profil.is_active !== true) {
    return <>{back}<div className="p2ban" role="alert">{pesanTarikBaris("ACCESS_DENIED: x")}</div></>;
  }
  const { data, error } = await db.rpc("clinic_owner_invoice_lines_check", { p_invoice_id: invoiceId });
  if (error || !data) return <>{back}<div className="p2ban" role="alert">{pesanTarikBaris(error?.message)}</div></>;
  const lines = (Array.isArray(data.lines) ? data.lines : []) as BarisTarik[];
  return <>
    {back}
    <h1 style={{ fontSize: 16, margin: "4px 0 10px" }}>Koreksi tagihan lunas {data.invoice_no}</h1>
    <TarikBarisForm key={invoiceId} visitId={visitId} invoiceId={invoiceId} invoiceNo={String(data.invoice_no)} lines={lines} requestKey={randomUUID()} />
  </>;
}
