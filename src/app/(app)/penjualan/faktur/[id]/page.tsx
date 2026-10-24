import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { DocumentBackLink, DocumentLink } from "@/components/RelatedDocuments";
import { documentAnchor } from "@/lib/related-document-routes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { WholesaleCorrectionForm } from "./WholesaleCorrectionForm";
import { readCompleteList } from "@/lib/checked-list";

const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
type Receipt = { advance_id: string | null; advance: {id: string;no_um: string;status: string} | {id: string;no_um: string;status: string}[] | null; id: string; no_terima: string; tanggal: string; jumlah: number; dari_uang_muka: number; metode: string; journal_id: string | null };
type InvoiceReceipt = Receipt & { invoice_id: string };
type Invoice = { status: string; id: string; no_faktur: string; total: number; carried_paid: number; replaces_invoice_id: string | null; sales_receipts: Receipt[] };
type InvoiceSummary = Omit<Invoice, "sales_receipts">;
type Correction = { id: string; created_at: string; tanggal: string; reason: string; created_by: string | null;
  paid_preserved: number; customer_credit: number; original_journal_id: string | null;
  reversal_journal_id: string | null; replacement_journal_id: string | null; credit_journal_id: string | null };
type InvoiceCorrection = Correction & { invoice_id: string };

export default async function WholesaleInvoicePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string; from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: invoice, error } = await db.from("sales_invoices")
    .select("id,no_faktur,order_id,tanggal,jatuh_tempo,total,dpp,ppn,carried_paid,revision,status,voided_on,void_reason,replaces_invoice_id,catatan,customers(name)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Rincian faktur belum dapat dibaca: " + error.message);
  if (!invoice) notFound();
  const [{ data: profile }, lines, orderInvoices, settings] = await Promise.all([
    db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
    db.from("sales_invoice_items").select("id,nama,qty,harga,satuan,hpp").eq("invoice_id", id).order("id"),
    readCompleteList<InvoiceSummary>((from, to) => db.from("sales_invoices")
      .select("id,no_faktur,total,status,carried_paid,replaces_invoice_id", { count: "exact" })
      .eq(invoice.order_id ? "order_id" : "id", invoice.order_id ?? id).order("id").range(from, to),
    "Faktur dalam pesanan", { maxRows: null }),
    db.from("company_settings").select("ppn_rate").eq("id", true).maybeSingle(),
  ]);
  if (lines.error || settings.error) throw new Error("Rincian/alokasi pembayaran belum dapat diverifikasi. Muat ulang halaman.");
  const documents: Invoice[] = orderInvoices.map((row) => ({ ...row, sales_receipts: [] }));
  const byId = new Map(documents.map(i => [i.id, i]));
  if (!byId.has(id)) throw new Error("Faktur aktif belum dapat diverifikasi dalam rangkaian pesanan. Muat ulang halaman.");
  const ancestors: Invoice[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(id);
  while (cursor && !visited.has(cursor.id)) {
    ancestors.push(cursor); visited.add(cursor.id);
    cursor = cursor.replaces_invoice_id ? byId.get(cursor.replaces_invoice_id) : undefined;
  }
  // Keep each IN filter below typical URL limits, including very long correction chains.
  const invoiceGroups: string[][] = [];
  for (let start = 0; start < ancestors.length; start += 50) {
    invoiceGroups.push(ancestors.slice(start, start + 50).map((source) => source.id));
  }
  const receiptGroups = await Promise.all(invoiceGroups.map((ids) => readCompleteList<InvoiceReceipt>((from, to) => db.from("sales_receipts")
    .select("id,invoice_id,no_terima,tanggal,jumlah,dari_uang_muka,advance_id,advance:sales_advances!advance_id(id,no_um,status),metode,journal_id", { count: "exact" })
    .in("invoice_id", ids).order("id").range(from, to),
  "Penerimaan faktur", { maxRows: null })));
  const receiptByInvoice = new Map<string, Receipt[]>();
  for (const receipt of receiptGroups.flat()) {
    const rows = receiptByInvoice.get(receipt.invoice_id) ?? [];
    rows.push(receipt);
    receiptByInvoice.set(receipt.invoice_id, rows);
  }
  for (const source of ancestors) source.sales_receipts = receiptByInvoice.get(source.id) ?? [];
  const ownPaid = (byId.get(id)?.sales_receipts ?? []).reduce((sum, r) => sum + Number(r.jumlah), 0);
  const paid = Number(invoice.carried_paid) + ownPaid;
  const successor = documents.find(i => i.replaces_invoice_id === id);
  const correctionLists = await Promise.all(invoiceGroups.map((ids) => readCompleteList<InvoiceCorrection>((from, to) => db.from("wholesale_invoice_corrections")
    .select("id,invoice_id,reason,tanggal,customer_credit,paid_preserved,original_journal_id,reversal_journal_id,replacement_journal_id,credit_journal_id,created_at,created_by", { count: "exact" })
    .in("invoice_id", ids).order("created_at").order("id").range(from, to),
  "Riwayat koreksi", { maxRows: null })));
  const corrections = correctionLists.flat().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const credits = corrections.reduce((sum, c) => sum + Number(c.customer_credit), 0);
  const customer = Array.isArray(invoice.customers) ? invoice.customers[0] : invoice.customers;
  const today = hariIniWIB();
  return <>
    <DocumentBackLink from={sp.from} />
    <ActivityHistoryLink entity="sales_invoices" id={id} />
    <Link className="back-btn" href="/penjualan/faktur">← Faktur & penerimaan</Link>
    <div className="crm-sec">
      <h1 style={{ fontSize: 18 }}>{invoice.no_faktur}</h1>
      {sp.error && <div className="p2ban" role="alert">{sp.error}</div>}
      {sp.success && <div className="p2ban" role="status">{sp.success}</div>}
      <p>{customer?.name ?? "Tanpa pelanggan"} · {invoice.tanggal} · jatuh tempo {invoice.jatuh_tempo} · {invoice.status}</p>
      <p>Total {rp(invoice.total)} · Pembayaran terbawa {rp(invoice.carried_paid)} · Penerimaan faktur ini {rp(ownPaid)} · Sisa piutang {rp(invoice.status === "batal" ? 0 : Math.max(0, Number(invoice.total) - paid))}</p>
      {invoice.order_id && <p><Link href={`/penjualan/pesanan/${invoice.order_id}`}>Buka pesanan dan bukti pengiriman fisik</Link></p>}
      {invoice.replaces_invoice_id && <p>{byId.has(invoice.replaces_invoice_id) ? <>Menggantikan <DocumentLink kind="sales-invoice" id={invoice.replaces_invoice_id} from={`/penjualan/faktur/${id}`}>{byId.get(invoice.replaces_invoice_id)!.no_faktur}</DocumentLink> · {byId.get(invoice.replaces_invoice_id)!.status}</> : "Faktur asal tidak tersedia atau tidak dapat diakses."}</p>}
      {successor && <p>Diganti oleh <DocumentLink kind="sales-invoice" id={successor.id} from={`/penjualan/faktur/${id}`}>{successor.no_faktur}</DocumentLink> · {successor.status}</p>}
      {invoice.voided_on && <p>Dibatalkan {invoice.voided_on}: {invoice.void_reason}. Pengiriman fisik dan dokumen asli tetap disimpan.</p>}
      <div style={{overflowX:"auto"}}><table className="tbl"><thead><tr><th>Barang</th><th>Qty</th><th>Harga</th><th>HPP alokasi</th></tr></thead><tbody>
        {(lines.data ?? []).map(i => <tr key={i.id}><td>{i.nama}</td><td>{Number(i.qty)} {i.satuan}</td><td>{rp(i.harga)}</td><td>{rp(i.hpp ?? 0)}</td></tr>)}
      </tbody></table></div>
    </div>
    <div className="crm-sec">
      <h2 style={{ fontSize: 14 }}>Riwayat pembayaran asli</h2>
      {ancestors.some(i => i.replaces_invoice_id && !byId.has(i.replaces_invoice_id)) && <p>Sebagian riwayat faktur asal tidak tersedia atau tidak dapat diakses. Pembayaran lama tidak direkonstruksi.</p>}
      <p>Pembayaran dari faktur terdahulu dibawa sebagai pelunasan pengganti. Angka di bawah adalah transaksi uang asli; tidak dijumlah ulang sebagai kas masuk.</p>
      <div style={{overflowX:"auto"}}><table className="tbl"><thead><tr><th>Penerimaan</th><th>Faktur asal</th><th>Tanggal</th><th>Jumlah</th><th>Dari uang muka / dokumen</th><th>Status</th></tr></thead><tbody>
        {ancestors.flatMap(i => (i.sales_receipts ?? []).map(r => { const advance=Array.isArray(r.advance)?r.advance[0]:r.advance;return <tr id={documentAnchor('receipt',r.id)} style={{scrollMarginTop:90}} key={r.id}>
          <td><DocumentLink kind="sales-receipt" id={r.id} parentId={i.id} from={i.id===id?undefined:`/penjualan/faktur/${id}`}>{r.no_terima}</DocumentLink> · {r.metode}<div><ActivityHistoryLink entity="sales_receipts" id={r.id} /></div></td>
          <td><DocumentLink kind="sales-invoice" id={i.id} from={i.id===id?undefined:`/penjualan/faktur/${id}`}>{i.no_faktur}</DocumentLink></td><td>{r.tanggal}</td><td>{rp(r.jumlah)}</td>
          <td>{rp(r.dari_uang_muka ?? 0)}{advance ? <p><DocumentLink kind="sales-advance" id={advance.id} from={`/penjualan/faktur/${id}#receipt-${r.id}`}>Uang muka {advance.no_um}</DocumentLink> · {advance.status}</p> : (r.advance_id || Number(r.dari_uang_muka)>0) && <p>Uang muka terkait tidak tersedia atau tidak dapat diakses. Alokasi lama tidak ditebak.</p>}</td>
          <td>Transaksi uang tersimpan{ i.status==='batal' ? ' · faktur asal dibatalkan' : ''}</td>
        </tr>}))}
      </tbody></table></div>
      <p>Kredit pelanggan dari rangkaian ini: <strong>{rp(credits)}</strong>. Tercatat sebagai kewajiban pada akun 2103, terpisah dari uang muka yang dapat dipakai. Penyelesaian atau usulan pengembalian perlu ditinjau keuangan; tidak ada refund/transfer otomatis.</p>
      {invoice.status === "batal" && !successor && <Link href="/penjualan/faktur">Buka daftar penerimaan dan kredit</Link>}
    </div>
    <div className="crm-sec">
      <h2 style={{ fontSize: 14 }}>Audit koreksi</h2>
      {corrections.map(c => <div key={c.id} style={{ paddingBottom: 10 }}>
        <div>{c.tanggal} · {c.reason} · oleh {c.created_by}</div>
        <div>Pembayaran dipertahankan {rp(c.paid_preserved)} · kredit {rp(c.customer_credit)}</div>
        <div style={{ fontSize: 11 }}>Jurnal asli {c.original_journal_id} · pembalik {c.reversal_journal_id}{c.replacement_journal_id ? ` · pengganti ${c.replacement_journal_id}` : ""}{c.credit_journal_id ? ` · kredit ${c.credit_journal_id}` : ""}</div>
      </div>)}
      {!corrections.length && <p>Belum ada koreksi.</p>}
    </div>
    {profile?.is_active && profile.role === "OWNER" && invoice.order_id && invoice.status !== "batal" && <div className="crm-sec">
      <h2 style={{ fontSize: 14 }}>Koreksi pencatatan grosir — OWNER</h2>
      <WholesaleCorrectionForm userId={user?.id ?? ""} invoiceId={id} revision={Number(invoice.revision)} today={today} due={invoice.jatuh_tempo} note={invoice.catatan ?? ""} paid={paid} total={Number(invoice.total)}
        taxRate={Number(invoice.ppn) > 0 ? Number(settings.data?.ppn_rate) || 11 : 0} items={(lines.data ?? []).map(i => ({ id: i.id, nama: i.nama, qty: Number(i.qty), harga: Number(i.harga), satuan: i.satuan }))} />
    </div>}
  </>;
}
