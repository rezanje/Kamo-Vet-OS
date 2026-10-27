import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { DocumentBackLink, DocumentLink, RelatedDocuments, type RelatedDocument } from "@/components/RelatedDocuments";
import { documentAnchor } from "@/lib/related-document-routes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { SecHeader } from "@/components/SecHeader";
import { InvoiceCorrectionForm } from "./InvoiceCorrectionForm";
import { PaymentCorrectionForm } from "./PaymentCorrectionForm";
import { PurchaseCorrectionRequestPanel } from "@/components/PurchaseCorrectionRequestPanel";
import { loadRequestsForSource, type PurchaseCorrectionRequest } from "@/lib/purchase-correction-requests";

const rp = (value: number) => `Rp ${Number(value).toLocaleString("id-ID")}`;
type Rel<T> = T | T[] | null;
const one = <T,>(value: Rel<T>) => Array.isArray(value) ? value[0] ?? null : value;
type Payment = { advance_id: string | null; advance: Rel<{id: string; no_um: string; status: string}>; payment_order: Rel<{id: string; no_pp: string; status: string}>; replaces_payment_id: string | null; id: string; tanggal: string; amount: number; metode: string; catatan: string | null; dari_uang_muka: number; payment_order_id: string | null; reversal_of: string | null; voided_at: string | null; revision: number; journal_id: string | null };
type InvoiceItem = { id: string; nama: string; qty: number; satuan: string | null; harga: number };

export default async function PurchaseInvoiceDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string; from?: string; koreksi?: string; koreksi_error?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: invoice, error }, { data: profile }] = await Promise.all([
    supabase.from("purchase_invoices").select("id,revision,voided_at,void_reason,replaces_invoice_id,no_faktur,no_faktur_pemasok,tanggal,jatuh_tempo,total,po_id,keterangan,opening_batch_id,purchase_orders(id,no_po,status)").eq("id", id).maybeSingle(),
    supabase.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
  ]);
  if (error) throw new Error("Faktur dan riwayat pembayaran belum dapat dimuat.");
  if (!invoice) notFound();
  // Embedded relations may stop at the API row limit without reporting a partial result.
  // Verify every page before displaying a payment total or offering correction controls.
  // A failed read stays visible as unknown; it is never shown as "no request".
  const correctionRequestsRead: Promise<PurchaseCorrectionRequest[] | null> = loadRequestsForSource(supabase, "purchase_invoice", id).catch(() => null);
  const [items, payments] = await Promise.all([
    readCompleteList<InvoiceItem>((from, to) => supabase.from("purchase_invoice_items")
      .select("id,nama,qty,satuan,harga", { count: "exact" }).eq("invoice_id", id).order("id").range(from, to), "Baris faktur pembelian", { maxRows: null }),
    readCompleteList<Payment>((from, to) => supabase.from("purchase_invoice_payments")
      .select("id,tanggal,amount,metode,catatan,dari_uang_muka,advance_id,advance:purchase_advances!advance_id(id,no_um,status),payment_order_id,payment_order:payment_orders!payment_order_id(id,no_pp,status),replaces_payment_id,reversal_of,voided_at,revision,journal_id", { count: "exact" })
      .eq("invoice_id", id).order("tanggal").order("id").range(from, to), "Riwayat pembayaran faktur pembelian", { maxRows: null }),
  ]);
  const po = one(invoice.purchase_orders);
  const correctionRequests = await correctionRequestsRead;
  const [replacementResult, originalResult, receipts, returns] = await Promise.all([
    supabase.from('purchase_invoices').select('id,no_faktur,voided_at').eq('replaces_invoice_id',id).maybeSingle(),
    invoice.replaces_invoice_id ? supabase.from('purchase_invoices').select('id,no_faktur,voided_at').eq('id',invoice.replaces_invoice_id).maybeSingle() : {data:null,error:null},
    po && invoice.po_id ? supabase.from('goods_receipts').select('id,no_terima').eq('po_id',invoice.po_id).order('tanggal') : {data:[],error:null},
    po && invoice.po_id ? supabase.from('purchase_returns').select('id,no_retur,voided_at').eq('po_id',invoice.po_id).order('tanggal') : {data:[],error:null},
  ]);
  const replacement = replacementResult.data;
  const replacementError = replacementResult.error;
  const original = originalResult.data;
  const related: RelatedDocument[] = [
    ...(po ? [{kind:'purchase-order' as const,id:po.id,label:`PO ${po.no_po ?? 'tanpa nomor'}`,status:po.status}] : []),
    ...(original ? [{kind:'purchase-invoice' as const,id:original.id,label:`Faktur asal ${original.no_faktur}`,status:original.voided_at?'Dibatalkan':'Aktif'}] : []),
    ...(replacement ? [{kind:'purchase-invoice' as const,id:replacement.id,label:`Faktur pengganti ${replacement.no_faktur}`,status:replacement.voided_at?'Dibatalkan':'Aktif'}] : []),
    ...payments.map(p => ({kind:'purchase-payment' as const,id:p.id,parentId:id,label:`Pembayaran ${p.tanggal} · ${rp(p.amount)}`,status:p.reversal_of?'Pembalik pembayaran':p.voided_at?'Dibatalkan':p.replaces_payment_id?'Pengganti':'Tersimpan'})),
    ...(receipts.data ?? []).map(r => ({kind:'goods-receipt' as const,id:r.id,label:`Penerimaan ${r.no_terima}`,status:'Dokumen tersimpan'})),
    ...(returns.data ?? []).map(r => ({kind:'purchase-return' as const,id:r.id,label:`Retur PO ${r.no_retur}`,status:r.voided_at?'Dibatalkan':'Tersimpan'})),
  ];
  const owner = profile?.role === "OWNER" && profile.is_active;
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return <>
    <DocumentBackLink from={sp.from} />
    <ActivityHistoryLink entity="purchase_invoices" id={id} />
    <Link className="back-btn" href="/pembelian/faktur">Kembali ke faktur pembelian</Link>
    {sp.success && <div role="status" className="p2ban">{sp.success}</div>}
    {sp.error && <div role="alert" className="p2ban">{sp.error}</div>}
    <section className="crm-sec">
      <SecHeader num="01" title={invoice.no_faktur} desc={`Tanggal ${invoice.tanggal} · jatuh tempo ${invoice.jatuh_tempo}`} />
      <p><strong>{invoice.voided_at ? "Faktur dibatalkan" : "Faktur aktif"}</strong></p>
      {invoice.opening_batch_id && <p><span className="bge b">Saldo awal</span> Sisa hutang dari Accurate per tanggal cutover, tanpa barang, stok, atau PPN. Bayar lewat Pembayaran Hutang; pembatalan/koreksi faktur tidak tersedia.</p>}
      {invoice.void_reason && <p>Alasan: {invoice.void_reason}</p>}
      {invoice.replaces_invoice_id && !original && <p>Faktur asal tidak tersedia atau tidak dapat diakses.</p>}

      {invoice.voided_at && !replacement && !replacementError && <Link className="btn-def" href={`/pembelian/faktur/${invoice.po_id ? "baru" : "langsung"}?replace_invoice=${id}`}>Siapkan faktur pengganti</Link>}
      <p>Total {rp(invoice.total)} · Pembayaran bersih {rp(paid)}</p>
      <p>{invoice.no_faktur_pemasok && `Nomor pemasok: ${invoice.no_faktur_pemasok}. `}{invoice.keterangan}</p>
      {invoice.po_id && !po && <p>PO terkait tidak tersedia atau tidak dapat diakses.</p>}
      <div style={{overflowX:"auto"}}><table className="tbl"><thead><tr><th>Barang</th><th>Jumlah</th><th>Harga</th></tr></thead><tbody>
        {items.map(line => <tr key={line.id}><td>{line.nama}</td><td>{line.qty} {line.satuan}</td><td>{rp(line.harga)}</td></tr>)}
      </tbody></table></div>
      {!invoice.voided_at && <Link className="btn-def" href="/keuangan/hutang">Periksa sisa hutang &amp; bayar</Link>}
      {owner && !invoice.opening_batch_id && <InvoiceCorrectionForm userId={user!.id} invoiceId={id} revision={invoice.revision} voided={!!invoice.voided_at} />}
    </section>
    <PurchaseCorrectionRequestPanel kind="purchase_invoice" sourceId={id} label={invoice.no_faktur} owner={!!owner}
      requests={correctionRequests} requestKey={crypto.randomUUID()}
      notice={sp.koreksi === "terkirim" ? "Permintaan koreksi tersimpan dan masuk antrean Super Admin." : undefined} error={sp.koreksi_error} />
    <RelatedDocuments documents={related} from={`/pembelian/faktur/${id}`} error={!!receipts.error || !!returns.error || !!replacementError || !!originalResult.error} note={invoice.po_id ? "Penerimaan dan retur dikelompokkan melalui PO yang sama; alokasi langsung ke faktur ini tidak tersimpan." : "Faktur ini tidak memiliki relasi PO tersimpan. Penerimaan dan retur tidak ditebak dari nomor dokumen."} />
    <section className="crm-sec">
      <SecHeader num="02" title="RIWAYAT PEMBAYARAN" desc="Pembatalan mempertahankan pembayaran asli dan mencatat pembaliknya. Faktur dan barang tetap tercatat." />
      {payments.length === 0 && <p>Belum ada pembayaran.</p>}
      {payments.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.id.localeCompare(b.id)).map(payment => <article id={documentAnchor("payment",payment.id)} key={payment.id} style={{ scrollMarginTop: 90, borderBottom: "1px solid var(--bd)", padding: "12px 0" }}>
        <ActivityHistoryLink entity="purchase_invoice_payments" id={payment.id} />
        <p><strong>{payment.reversal_of ? "Pembalik pembayaran" : payment.voided_at ? "Pembayaran dibatalkan" : payment.replaces_payment_id ? "Pembayaran pengganti" : "Pembayaran"}</strong> · {payment.tanggal} · {rp(payment.amount)} · {payment.metode}</p>
        {!!Number(payment.dari_uang_muka) && <p>Porsi uang muka: {rp(payment.dari_uang_muka)}</p>}
        <p><DocumentLink kind="purchase-payment" id={payment.id} parentId={id}>Buka pembayaran ini</DocumentLink></p>
        {payment.reversal_of && <p>Pembalik dari {payments.some(p => p.id===payment.reversal_of) ? <DocumentLink kind="purchase-payment" id={payment.reversal_of} parentId={id}>pembayaran asal</DocumentLink> : 'pembayaran yang tidak tersedia atau tidak dapat diakses'}</p>}
        {payment.replaces_payment_id && <p>Menggantikan {payments.some(p => p.id===payment.replaces_payment_id) ? <DocumentLink kind="purchase-payment" id={payment.replaces_payment_id} parentId={id}>pembayaran asal</DocumentLink> : 'pembayaran yang tidak tersedia atau tidak dapat diakses'}</p>}
        {payments.filter(p => p.replaces_payment_id===payment.id).map(p => <p key={p.id}><DocumentLink kind="purchase-payment" id={p.id} parentId={id}>Buka pembayaran pengganti</DocumentLink></p>)}
        {payments.filter(p => p.reversal_of===payment.id).map(p => <p key={p.id}><DocumentLink kind="purchase-payment" id={p.id} parentId={id}>Buka pembalik pembayaran</DocumentLink></p>)}
        {one(payment.advance) ? <p><DocumentLink kind="purchase-advance" id={one(payment.advance)!.id} from={`/pembelian/faktur/${id}#payment-${payment.id}`}>Uang muka {one(payment.advance)!.no_um}</DocumentLink> · {one(payment.advance)!.status}</p> : (payment.advance_id || Number(payment.dari_uang_muka)>0) && <p>Uang muka terkait tidak tersedia atau tidak dapat diakses. Alokasi lama tidak ditebak.</p>}
        {payment.catatan && <p>{payment.catatan}</p>}
        {one(payment.payment_order) ? <p><DocumentLink kind="payment-order" id={one(payment.payment_order)!.id} from={`/pembelian/faktur/${id}#payment-${payment.id}`}>Perintah bayar {one(payment.payment_order)!.no_pp}</DocumentLink> · {one(payment.payment_order)!.status}</p> : payment.payment_order_id && <p>Perintah bayar terkait tidak tersedia atau tidak dapat diakses.</p>}
        {owner && !payment.reversal_of && !payment.voided_at && <details><summary className="btn-def">Koreksi pembayaran</summary>
          <PaymentCorrectionForm userId={user!.id} invoiceId={id} paymentId={payment.id} revision={payment.revision} grouped={!!payment.payment_order_id} />
        </details>}
        {owner && !invoice.voided_at && payment.voided_at && !payment.payment_order_id && !payments.some(p => p.replaces_payment_id === payment.id) && <Link href={`/keuangan/hutang?replace_payment=${payment.id}`}>Siapkan pembayaran pengganti</Link>}
      </article>)}
    </section>
  </>;
}
