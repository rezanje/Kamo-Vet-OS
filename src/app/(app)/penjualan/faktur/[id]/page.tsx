import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { DocumentBackLink, DocumentLink } from "@/components/RelatedDocuments";
import { documentAnchor } from "@/lib/related-document-routes";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { WholesaleCorrectionForm } from "./WholesaleCorrectionForm";
import { FakturLineEdit } from "./FakturLineEdit";
import { ReceiptDeleteForm } from "./ReceiptDeleteForm";
import { readCompleteList } from "@/lib/checked-list";
import { bisaKoreksiGrosir } from "@/lib/wholesale-correction-access";
import { alasanTidakBisaEdit, penerimaanAktif, subtotalBaris, type BarisFakturEdit } from "@/lib/faktur-jual-edit";
import { alasanTidakBisaRetur, bisaReturGrosir, sisaPiutangGrosir } from "@/lib/retur-grosir";

const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
type Receipt = { advance_id: string | null; advance: {id: string;no_um: string;status: string} | {id: string;no_um: string;status: string}[] | null; id: string; no_terima: string; tanggal: string; jumlah: number; dari_uang_muka: number; metode: string; journal_id: string | null; voided_at: string | null; void_reason: string | null; reversal_of: string | null; revision: number };
type InvoiceReceipt = Receipt & { invoice_id: string };
type Invoice = { status: string; id: string; no_faktur: string; total: number; carried_paid: number; replaces_invoice_id: string | null; sales_receipts: Receipt[] };
type InvoiceSummary = Omit<Invoice, "sales_receipts">;
type Correction = { id: string; created_at: string; tanggal: string; reason: string; created_by: string | null;
  paid_preserved: number; customer_credit: number; original_journal_id: string | null;
  reversal_journal_id: string | null; replacement_journal_id: string | null; credit_journal_id: string | null };
type InvoiceCorrection = Correction & { invoice_id: string };
type OrderLine = { id: string; qty_kirim: number; qty_faktur: number };
type WholesaleReturn = { id: string; no_retur: string; tanggal: string; total: number; ar_reduction: number; customer_credit: number; status: string; voided_on: string | null };
type ReceiptCancellation = { id: string; invoice_id: string; tanggal: string; reason: string; created_by: string | null;
  created_at: string; advance_restored: number; original_journal_id: string; reversal_journal_id: string };

export default async function WholesaleInvoicePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string; from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const { data: invoice, error } = await db.from("sales_invoices")
    .select("id,no_faktur,order_id,tanggal,jatuh_tempo,total,dpp,ppn,carried_paid,returned_ar,revision,status,voided_on,void_reason,replaces_invoice_id,catatan,kategori,opening_batch_id,customers(name)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Rincian faktur belum dapat dibaca: " + error.message);
  if (!invoice) notFound();
  const [{ data: profile }, lines, orderInvoices, settings, returnRows] = await Promise.all([
    db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
    db.from("sales_invoice_items").select("id,nama,qty,harga,diskon,satuan,hpp,order_item_id").eq("invoice_id", id).order("id"),
    readCompleteList<InvoiceSummary>((from, to) => db.from("sales_invoices")
      .select("id,no_faktur,total,status,carried_paid,replaces_invoice_id", { count: "exact" })
      .eq(invoice.order_id ? "order_id" : "id", invoice.order_id ?? id).order("id").range(from, to),
    "Faktur dalam pesanan", { maxRows: null }),
    db.from("company_settings").select("ppn_rate").eq("id", true).maybeSingle(),
    // Retur grosir atas faktur ini (tautan tetap lewat invoice_id), termasuk yang dibatalkan.
    readCompleteList<WholesaleReturn>((from, to) => db.from("wholesale_returns")
      .select("id,no_retur,tanggal,total,ar_reduction,customer_credit,status,voided_on", { count: "exact" })
      .eq("invoice_id", id).order("tanggal").order("no_retur").range(from, to), "Retur faktur", { maxRows: null }),
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
    .select("id,invoice_id,no_terima,tanggal,jumlah,dari_uang_muka,advance_id,advance:sales_advances!advance_id(id,no_um,status),metode,journal_id,voided_at,void_reason,reversal_of,revision", { count: "exact" })
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
  const cancellationLists = await Promise.all(invoiceGroups.map((ids) => readCompleteList<ReceiptCancellation>((from, to) => db.from("sales_receipt_cancellations")
    .select("id,invoice_id,tanggal,reason,created_by,created_at,advance_restored,original_journal_id,reversal_journal_id", { count: "exact" })
    .in("invoice_id", ids).order("created_at").order("id").range(from, to),
  "Riwayat hapus penerimaan", { maxRows: null })));
  const cancellations = cancellationLists.flat().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const activeReturns = returnRows.filter((r) => r.status === "posted");
  const returnCredits = activeReturns.reduce((sum, r) => sum + Number(r.customer_credit), 0);
  const credits = corrections.reduce((sum, c) => sum + Number(c.customer_credit), 0) + returnCredits;
  const customer = Array.isArray(invoice.customers) ? invoice.customers[0] : invoice.customers;
  const today = hariIniWIB();
  // Batas qty per baris: yang sudah dikirim dan belum ditagih faktur lain, ditambah qty baris ini.
  const orderLines = invoice.order_id
    ? await readCompleteList<OrderLine>((from, to) => db.from("sales_order_items")
      .select("id,qty_kirim,qty_faktur", { count: "exact" })
      .eq("order_id", invoice.order_id!).order("id").range(from, to), "Baris pesanan faktur", { maxRows: null })
    : [];
  const orderById = new Map(orderLines.map((row) => [row.id, row]));
  const bolehKoreksi = bisaKoreksiGrosir(profile);
  const ownReceipts = byId.get(id)?.sales_receipts ?? [];
  const adaReturAktif = activeReturns.length > 0;
  const BLOKIR_RETUR = "Faktur ini punya retur penjualan aktif. Batalkan returnya dulu sebelum mengedit atau mengoreksi faktur.";
  const blokirEdit = adaReturAktif && invoice.status !== "batal" ? BLOKIR_RETUR : alasanTidakBisaEdit(
    { status: invoice.status, order_id: invoice.order_id, opening_batch_id: invoice.opening_batch_id, kategori: invoice.kategori, carried_paid: Number(invoice.carried_paid) },
    ownReceipts, !!successor);
  const bolehRetur = bisaReturGrosir(profile) && !alasanTidakBisaRetur(invoice, !!successor);
  const barisEdit: BarisFakturEdit[] = (lines.data ?? []).map((i) => {
    const asal = i.order_item_id ? orderById.get(i.order_item_id) : undefined;
    const sisa = asal ? Number(asal.qty_kirim) - Number(asal.qty_faktur) : 0;
    return { id: i.id, nama: i.nama, satuan: i.satuan, qty: Number(i.qty), harga: Number(i.harga), diskon: Number(i.diskon ?? 0), maksQty: Number(i.qty) + Math.max(0, sisa) };
  });
  const hppBaris = new Map((lines.data ?? []).map((i) => [i.id, Number(i.hpp ?? 0)]));
  const bolehEditBaris = bolehKoreksi && !blokirEdit && barisEdit.length > 0 && !!user;
  const taxRate = Number(invoice.ppn) > 0 ? Number(settings.data?.ppn_rate) || 11 : 0;
  return <>
    <DocumentBackLink from={sp.from} />
    <ActivityHistoryLink entity="sales_invoices" id={id} />
    <Link className="back-btn" href="/penjualan/faktur">← Faktur & penerimaan</Link>
    <div className="crm-sec">
      <h1 style={{ fontSize: 18 }}>{invoice.no_faktur}</h1>
      {sp.error && <div className="p2ban" role="alert">{sp.error}</div>}
      {sp.success && <div className="p2ban" role="status">{sp.success}</div>}
      <p>{customer?.name ?? "Tanpa pelanggan"} · {invoice.tanggal ?? "tanggal faktur tidak ada"} · jatuh tempo {invoice.jatuh_tempo ?? "tidak ada"} · {invoice.status}</p>
      <p>Total {rp(invoice.total)} · Pembayaran terbawa {rp(invoice.carried_paid)} · Penerimaan faktur ini {rp(ownPaid)}{Number(invoice.returned_ar) > 0 && <> · Dikurangi retur {rp(invoice.returned_ar)}</>} · Sisa piutang {rp(sisaPiutangGrosir(invoice, ownPaid))}</p>
      {invoice.opening_batch_id && <p><span className="bge b">Saldo awal</span> {invoice.catatan} — sisa tagihan dari Accurate per tanggal cutover, tanpa barang, PPN, atau pendapatan periode ini. Terima pembayarannya dari daftar Faktur &amp; Penerimaan; pembatalan/koreksi tidak tersedia.</p>}
      {invoice.order_id && <p><Link href={`/penjualan/pesanan/${invoice.order_id}`}>Buka pesanan dan bukti pengiriman fisik</Link></p>}
      {invoice.replaces_invoice_id && <p>{byId.has(invoice.replaces_invoice_id) ? <>Menggantikan <DocumentLink kind="sales-invoice" id={invoice.replaces_invoice_id} from={`/penjualan/faktur/${id}`}>{byId.get(invoice.replaces_invoice_id)!.no_faktur}</DocumentLink> · {byId.get(invoice.replaces_invoice_id)!.status}</> : "Faktur asal tidak tersedia atau tidak dapat diakses."}</p>}
      {successor && <p>Diganti oleh <DocumentLink kind="sales-invoice" id={successor.id} from={`/penjualan/faktur/${id}`}>{successor.no_faktur}</DocumentLink> · {successor.status}</p>}
      {invoice.voided_on && <p>Dibatalkan {invoice.voided_on}: {invoice.void_reason}. Pengiriman fisik dan dokumen asli tetap disimpan.</p>}
      {(bolehKoreksi || bolehRetur) && <details style={{ margin: "6px 0 12px" }}>
        <summary className="btn-def" style={{ padding: "5px 12px", fontSize: 11, cursor: "pointer", listStyle: "none", display: "inline-block" }}>
          <i className="ti ti-dots-vertical" /> Aksi
        </summary>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "8px 0", fontSize: 11.5 }}>
          {bolehRetur && <Link className="btn-def" href={`/penjualan/retur-grosir/baru?faktur=${id}`} style={{ textDecoration: "none", padding: "5px 12px" }}><i className="ti ti-arrow-back-up" /> Retur barang</Link>}
          {!bolehKoreksi ? null : bolehEditBaris
            ? <Link className="btn-acc" href={`/penjualan/faktur/${id}#baris-faktur`} style={{ textDecoration: "none", padding: "5px 12px" }}><i className="ti ti-pencil" /> Edit faktur</Link>
            : <span style={{ color: "var(--td)" }}>Edit faktur tidak tersedia: {blokirEdit ?? "tidak ada baris barang untuk diedit."}</span>}
          {bolehKoreksi && penerimaanAktif(ownReceipts).length > 0 && <Link className="btn-def" href={`/penjualan/faktur/${id}#penerimaan`} style={{ textDecoration: "none", padding: "5px 12px" }}><i className="ti ti-trash" /> Hapus penerimaan</Link>}
        </div>
      </details>}
      <div id="baris-faktur" style={{overflowX:"auto", scrollMarginTop: 90}}><table className="tbl"><thead><tr><th>Barang</th><th>Qty</th><th>Harga</th><th>Diskon</th><th>Subtotal</th><th>HPP alokasi</th>{bolehEditBaris && <th>Aksi</th>}</tr></thead><tbody>
        {barisEdit.map((baris) => <tr key={baris.id}>
          <td>{baris.nama}</td><td>{baris.qty} {baris.satuan}</td><td>{rp(baris.harga)}</td><td>{rp(baris.diskon)}</td>
          <td>{rp(subtotalBaris(baris))}</td><td>{rp(hppBaris.get(baris.id) ?? 0)}</td>
          {bolehEditBaris && <td><FakturLineEdit key={`${baris.id}:${invoice.revision}`} invoiceId={id} revision={Number(invoice.revision)}
            today={today} jatuhTempo={invoice.jatuh_tempo ?? today} catatan={invoice.catatan ?? ""} taxRate={taxRate} rows={barisEdit} row={baris} /></td>}
        </tr>)}
      </tbody></table></div>
      {bolehKoreksi && blokirEdit && <p role="status" style={{ fontSize: 11.5 }}><i className="ti ti-info-circle" /> {blokirEdit}</p>}
      {bolehEditBaris && <p style={{ fontSize: 11, color: "var(--tm)" }}>
        Aksi → Edit membetulkan qty, harga dan diskon baris. Faktur lama dibalik jurnalnya dan terbit faktur pengganti bernomor baru;
        barang yang sudah dikirim tetap keluar gudang, jadi stok dan jurnal HPP pengiriman tidak berubah.
      </p>}
    </div>
    <div className="crm-sec" id="retur">
      <h2 style={{ fontSize: 14 }}>Retur penjualan</h2>
      {returnRows.length === 0 ? <p>Belum ada retur atas faktur ini.</p> : <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr>
        <th>Retur</th><th>Tanggal</th><th>Nilai</th><th>Kurangi piutang</th><th>Kredit pelanggan</th><th>Status</th>
      </tr></thead><tbody>
        {returnRows.map((r) => <tr key={r.id}>
          <td><DocumentLink kind="sales-return-wholesale" id={r.id} from={`/penjualan/faktur/${id}`}>{r.no_retur}</DocumentLink><div><ActivityHistoryLink entity="wholesale_returns" id={r.id} /></div></td>
          <td>{r.tanggal}</td><td>{rp(r.total)}</td><td>{rp(r.ar_reduction)}</td><td>{rp(r.customer_credit)}</td>
          <td>{r.status === "batal" ? `Dibatalkan ${r.voided_on ?? ""}` : "Terposting"}</td>
        </tr>)}
      </tbody></table></div>}
    </div>
    <div className="crm-sec">
      <h2 style={{ fontSize: 14 }}>Riwayat pembayaran asli</h2>
      {ancestors.some(i => i.replaces_invoice_id && !byId.has(i.replaces_invoice_id)) && <p>Sebagian riwayat faktur asal tidak tersedia atau tidak dapat diakses. Pembayaran lama tidak direkonstruksi.</p>}
      <p>Pembayaran dari faktur terdahulu dibawa sebagai pelunasan pengganti. Angka di bawah adalah transaksi uang asli; tidak dijumlah ulang sebagai kas masuk.</p>
      <div id="penerimaan" style={{overflowX:"auto", scrollMarginTop: 90}}><table className="tbl"><thead><tr><th>Penerimaan</th><th>Faktur asal</th><th>Tanggal</th><th>Jumlah</th><th>Dari uang muka / dokumen</th><th>Status</th>{bolehKoreksi && <th>Aksi</th>}</tr></thead><tbody>
        {ancestors.flatMap(i => (i.sales_receipts ?? []).map(r => { const advance=Array.isArray(r.advance)?r.advance[0]:r.advance;return <tr id={documentAnchor('receipt',r.id)} style={{scrollMarginTop:90}} key={r.id}>
          <td><DocumentLink kind="sales-receipt" id={r.id} parentId={i.id} from={i.id===id?undefined:`/penjualan/faktur/${id}`}>{r.no_terima}</DocumentLink> · {r.metode}<div><ActivityHistoryLink entity="sales_receipts" id={r.id} /></div></td>
          <td><DocumentLink kind="sales-invoice" id={i.id} from={i.id===id?undefined:`/penjualan/faktur/${id}`}>{i.no_faktur}</DocumentLink></td><td>{r.tanggal}</td><td>{rp(r.jumlah)}</td>
          <td>{rp(r.dari_uang_muka ?? 0)}{advance ? <p><DocumentLink kind="sales-advance" id={advance.id} from={`/penjualan/faktur/${id}#receipt-${r.id}`}>Uang muka {advance.no_um}</DocumentLink> · {advance.status}</p> : (r.advance_id || Number(r.dari_uang_muka)>0) && <p>Uang muka terkait tidak tersedia atau tidak dapat diakses. Alokasi lama tidak ditebak.</p>}</td>
          <td>{r.reversal_of ? 'Pembalik penerimaan' : r.voided_at ? `Dihapus · ${r.void_reason ?? ''}` : 'Transaksi uang tersimpan'}{ i.status==='batal' ? ' · faktur asal dibatalkan' : ''}</td>
          {bolehKoreksi && <td>{i.id===id && !r.voided_at && !r.reversal_of && invoice.status!=='batal' && !successor && user
            ? <ReceiptDeleteForm userId={user.id} invoiceId={id} receiptId={r.id} noTerima={r.no_terima} revision={Number(r.revision)} dariUangMuka={Number(r.dari_uang_muka ?? 0)} />
            : <span style={{ fontSize: 10.5, color: "var(--td)" }}>—</span>}</td>}
        </tr>}))}
      </tbody></table></div>
      <p>Kredit pelanggan dari rangkaian ini: <strong>{rp(credits)}</strong>. Tercatat sebagai kewajiban pada akun 314001, terpisah dari uang muka yang dapat dipakai. Penyelesaian atau usulan pengembalian perlu ditinjau keuangan; tidak ada refund/transfer otomatis.</p>
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
      <h3 style={{ fontSize: 13, marginTop: 12 }}>Penerimaan yang dihapus</h3>
      {cancellations.map(c => <div key={c.id} style={{ paddingBottom: 10 }}>
        <div>{c.tanggal} · {c.reason} · oleh {c.created_by}</div>
        <div>Uang muka dikembalikan {rp(c.advance_restored)}</div>
        <div style={{ fontSize: 11 }}>Jurnal asli {c.original_journal_id} · pembalik {c.reversal_journal_id}</div>
      </div>)}
      {!cancellations.length && <p>Belum ada penerimaan yang dihapus.</p>}
    </div>
    {bisaKoreksiGrosir(profile) && invoice.order_id && invoice.status !== "batal" && adaReturAktif && <div className="crm-sec">
      <h2 style={{ fontSize: 14 }}>Koreksi pencatatan grosir — OWNER/FINANCE</h2>
      <p role="status">{BLOKIR_RETUR}</p>
    </div>}
    {bisaKoreksiGrosir(profile) && invoice.order_id && invoice.status !== "batal" && !adaReturAktif && <div className="crm-sec">
      <h2 style={{ fontSize: 14 }}>Koreksi pencatatan grosir — OWNER/FINANCE</h2>
      <WholesaleCorrectionForm userId={user?.id ?? ""} invoiceId={id} revision={Number(invoice.revision)} today={today} due={invoice.jatuh_tempo} note={invoice.catatan ?? ""} paid={paid} total={Number(invoice.total)}
        taxRate={Number(invoice.ppn) > 0 ? Number(settings.data?.ppn_rate) || 11 : 0} items={(lines.data ?? []).map(i => ({ id: i.id, nama: i.nama, qty: Number(i.qty), harga: Number(i.harga), diskon: Number(i.diskon ?? 0), satuan: i.satuan }))} />
    </div>}
  </>;
}
