import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { pesanBatalPenerimaan, ringkasanPratinjau, type PratinjauBatal } from "@/lib/batal-penerimaan-pesan";
import { BatalPenerimaanForm } from "./BatalPenerimaanForm";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Batalkan penerimaan tagihan klinik (Owner / peran berizin). Halaman terpisah: kasir/PembayaranForm tidak disentuh. */
export default async function BatalPenerimaanPage({ params, searchParams }: { params: Promise<{ visitId: string }>; searchParams: Promise<{ invoice_id?: string }> }) {
  const { visitId } = await params; const { invoice_id: invoiceId } = await searchParams;
  if (!uuid.test(visitId) || !invoiceId || !uuid.test(invoiceId)) notFound();
  const db = await createClient();
  const kembali = `/klinik/pembayaran/${visitId}?invoice_id=${invoiceId}`;
  const back = <div style={{ marginBottom: 8 }}><Link href={kembali} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke tagihan</Link></div>;
  const { data, error } = await db.rpc("clinic_cancel_invoice_receipt_preview", { p_invoice_id: invoiceId });
  if (error || !data) return <>{back}<div className="p2ban" role="alert">{pesanBatalPenerimaan(error?.message)}</div></>;
  const p = data as PratinjauBatal;
  if (p.refuse) return <>{back}<h1 style={{ fontSize: 16, margin: "4px 0 10px" }}>Batalkan penerimaan {p.invoice.no ?? ""}</h1><div className="p2ban" role="alert">{p.refuse.message}</div></>;
  return <>
    {back}
    <h1 style={{ fontSize: 16, margin: "4px 0 10px" }}>Batalkan penerimaan {p.invoice.no ?? ""}</h1>
    <BatalPenerimaanForm key={invoiceId} visitId={visitId} invoiceId={invoiceId} invoiceNo={String(p.invoice.no ?? "")}
      ringkasan={ringkasanPratinjau(p)} requestKey={randomUUID()} kembaliHref={kembali} />
  </>;
}
