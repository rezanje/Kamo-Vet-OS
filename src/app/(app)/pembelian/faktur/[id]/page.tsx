import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { InvoiceCorrectionForm } from "./InvoiceCorrectionForm";
import { PaymentCorrectionForm } from "./PaymentCorrectionForm";

const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID")}`;
type Payment = { id: string; tanggal: string; amount: number; metode: string; catatan: string | null; dari_uang_muka: number; payment_order_id: string | null; reversal_of: string | null; voided_at: string | null; revision: number; journal_id: string | null };

export default async function PurchaseInvoiceDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: invoice, error }, { data: profile }] = await Promise.all([
    supabase.from("purchase_invoices").select("id,revision,voided_at,void_reason,replaces_invoice_id,no_faktur,no_faktur_pemasok,tanggal,jatuh_tempo,total,po_id,keterangan,purchase_invoice_items(id,nama,qty,harga,satuan),purchase_invoice_payments(id,tanggal,amount,metode,catatan,dari_uang_muka,payment_order_id,reversal_of,voided_at,revision,journal_id)").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
  ]);
  if (error) throw new Error("Faktur dan riwayat pembayaran belum dapat dimuat.");
  if (!invoice) notFound();
  const { data: replacement } = await supabase.from("purchase_invoices").select("id,no_faktur").eq("replaces_invoice_id", id).maybeSingle();
  const owner = profile?.role === "OWNER" && profile.is_active;
  const payments = (invoice.purchase_invoice_payments ?? []) as Payment[];
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return <>
      <ActivityHistoryLink entity="purchase_invoices" id={id} />
    <Link className="back-btn" href="/pembelian/faktur">Kembali ke faktur pembelian</Link>
    {sp.success && <div role="status" className="p2ban">{sp.success}</div>}
    {sp.error && <div role="alert" className="p2ban">{sp.error}</div>}
    <section className="crm-sec">
      <SecHeader num="01" title={invoice.no_faktur} desc={`Tanggal ${invoice.tanggal} · jatuh tempo ${invoice.jatuh_tempo}`} />
      <p><strong>{invoice.voided_at ? "Faktur dibatalkan" : "Faktur aktif"}</strong></p>
      {invoice.void_reason && <p>Alasan: {invoice.void_reason}</p>}
      {invoice.replaces_invoice_id && <Link href={`/pembelian/faktur/${invoice.replaces_invoice_id}`}>Lihat faktur asal</Link>}
      {replacement && <Link href={`/pembelian/faktur/${replacement.id}`}>Lihat faktur pengganti {replacement.no_faktur}</Link>}
      {invoice.voided_at && !replacement && <Link className="btn-def" href={`/pembelian/faktur/${invoice.po_id ? "baru" : "langsung"}?replace_invoice=${id}`}>Siapkan faktur pengganti</Link>}
      <p>Total {rp(invoice.total)} · Pembayaran bersih {rp(paid)}</p>
      <p>{invoice.no_faktur_pemasok && `Nomor pemasok: ${invoice.no_faktur_pemasok}. `}{invoice.keterangan}</p>
      {invoice.po_id && <Link href={`/pembelian/${invoice.po_id}`}>Lihat pesanan pembelian</Link>}
      <table className="tbl"><thead><tr><th>Barang</th><th>Jumlah</th><th>Harga</th></tr></thead><tbody>
        {(invoice.purchase_invoice_items ?? []).map((line: { id: string; nama: string; qty: number; satuan: string | null; harga: number }) => <tr key={line.id}><td>{line.nama}</td><td>{line.qty} {line.satuan}</td><td>{rp(line.harga)}</td></tr>)}
      </tbody></table>
      {!invoice.voided_at && <Link className="btn-def" href="/keuangan/hutang">Periksa sisa hutang &amp; bayar</Link>}
      {owner && <InvoiceCorrectionForm userId={user!.id} invoiceId={id} revision={invoice.revision} voided={!!invoice.voided_at} />}
    </section>
    <section className="crm-sec">
      <SecHeader num="02" title="RIWAYAT PEMBAYARAN" desc="Pembatalan mempertahankan pembayaran asli dan mencatat pembaliknya. Faktur dan barang tetap tercatat." />
      {payments.length === 0 && <p>Belum ada pembayaran.</p>}
      {payments.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id)).map(payment => <article key={payment.id} style={{ borderBottom: "1px solid var(--bd)", padding: "12px 0" }}>
        <p><strong>{payment.reversal_of ? "Pembalik pembayaran" : payment.voided_at ? "Pembayaran dibatalkan" : "Pembayaran"}</strong> · {payment.tanggal} · {rp(payment.amount)} · {payment.metode}</p>
        {!!Number(payment.dari_uang_muka) && <p>Porsi uang muka: {rp(payment.dari_uang_muka)}</p>}
        {payment.catatan && <p>{payment.catatan}</p>}
        {payment.payment_order_id && <Link href="/pembelian/perintah-bayar">Lihat perintah bayar</Link>}
        {owner && !payment.reversal_of && !payment.voided_at && <details><summary className="btn-def">Koreksi pembayaran</summary>
          <PaymentCorrectionForm userId={user!.id} invoiceId={id} paymentId={payment.id} revision={payment.revision} grouped={!!payment.payment_order_id} />
        </details>}
        {owner && !invoice.voided_at && payment.voided_at && !payment.payment_order_id && <Link href={`/keuangan/hutang?replace_payment=${payment.id}`}>Siapkan pembayaran pengganti</Link>}
      </article>)}
    </section>
  </>;
}
