import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { DocumentLink } from "@/components/RelatedDocuments";
import { alasanTidakBisaRetur, bisaReturGrosir, sisaPiutangGrosir, type BarisFakturRetur, type ReturAktif } from "@/lib/retur-grosir";
import { ReturGrosirForm } from "./ReturGrosirForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export default async function ReturGrosirBaruPage({ searchParams }: { searchParams: Promise<{ faktur?: string; error?: string }> }) {
  const sp = await searchParams;
  const id = sp.faktur ?? "";
  if (!UUID.test(id)) notFound();
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const [{ data: profile }, { data: invoice, error }] = await Promise.all([
    db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
    db.from("sales_invoices")
      .select("id,no_faktur,order_id,status,tanggal,total,dpp,ppn,carried_paid,returned_ar,revision,branch_id,kategori,opening_batch_id,customers(name)")
      .eq("id", id).maybeSingle(),
  ]);
  if (error) throw new Error("Faktur belum dapat dibaca: " + error.message);
  if (!invoice) notFound();
  const [successor, lines, returns, receipts, warehouses] = await Promise.all([
    db.from("sales_invoices").select("id").eq("replaces_invoice_id", id).limit(1),
    db.from("sales_invoice_items").select("id,nama,satuan,qty,harga,diskon,hpp,item_id,items(item_type)").eq("invoice_id", id).order("id"),
    db.from("wholesale_returns").select("id,gross,diskon,ppn,wholesale_return_items(invoice_item_id,qty,gross,diskon,hpp)")
      .eq("invoice_id", id).eq("status", "posted"),
    db.from("sales_receipts").select("jumlah").eq("invoice_id", id),
    invoice.branch_id
      ? db.from("warehouses").select("id,name").eq("branch_id", invoice.branch_id).eq("is_active", true).order("name")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (successor.error || lines.error || returns.error || receipts.error || warehouses.error) {
    throw new Error("Rincian faktur, retur atau penerimaan belum dapat diverifikasi. Muat ulang halaman.");
  }
  const blokir = alasanTidakBisaRetur(invoice, (successor.data ?? []).length > 0);
  const baris: BarisFakturRetur[] = (lines.data ?? []).map((l) => {
    const item = one(l.items as Rel<{ item_type: string | null }>);
    return { id: l.id, nama: l.nama, satuan: l.satuan, qty: Number(l.qty), harga: Number(l.harga), diskon: Number(l.diskon ?? 0),
      hpp: Number(l.hpp ?? 0), stok: !!l.item_id && (item?.item_type ?? "Persediaan") === "Persediaan" };
  });
  const aktif: ReturAktif[] = (returns.data ?? []).map((r) => ({
    gross: Number(r.gross), diskon: Number(r.diskon), ppn: Number(r.ppn),
    items: (r.wholesale_return_items ?? []).map((i) => ({ invoice_item_id: i.invoice_item_id, qty: Number(i.qty), gross: Number(i.gross), diskon: Number(i.diskon), hpp: Number(i.hpp) })),
  }));
  const diterima = (receipts.data ?? []).reduce((a, r) => a + Number(r.jumlah), 0);
  const sisaPiutang = sisaPiutangGrosir(invoice, diterima);
  const customer = one(invoice.customers as Rel<{ name: string }>);
  const today = hariIniWIB();
  return <>
    <Link className="back-btn" href={`/penjualan/faktur/${id}`}>← Kembali ke faktur</Link>
    <div className="crm-sec">
      <h1 style={{ fontSize: 18 }}>Retur Penjualan atas <DocumentLink kind="sales-invoice" id={id}>{invoice.no_faktur}</DocumentLink></h1>
      {sp.error && <div className="p2ban" role="alert">{sp.error}</div>}
      <p>{customer?.name ?? "Tanpa pelanggan"} · faktur {invoice.tanggal} · total {rp(Number(invoice.total))} · sisa piutang {rp(sisaPiutang)}</p>
      <p style={{ fontSize: 11.5, color: "var(--tm)" }}>
        Barang kembali ke gudang pada modal (HPP) asal pengirimannya. Nilai retur mengurangi piutang faktur ini dulu;
        kalau faktur sudah dibayar, sisanya menjadi kredit pelanggan. Retur bisa dibatalkan OWNER/FINANCE selama barangnya belum terpakai.
      </p>
      {!bisaReturGrosir(profile) && <p role="alert">Retur faktur penjualan hanya untuk OWNER, ADMIN atau FINANCE aktif.</p>}
      {blokir && <p role="alert">{blokir}</p>}
      {bisaReturGrosir(profile) && !blokir && user && <ReturGrosirForm userId={user.id} invoiceId={id} revision={Number(invoice.revision)}
        today={today} minDate={invoice.tanggal ?? today} faktur={{ dpp: Number(invoice.dpp), ppn: Number(invoice.ppn) }}
        baris={baris} aktif={aktif} sisaPiutang={sisaPiutang} gudang={(warehouses.data ?? []) as { id: string; name: string }[]} />}
    </div>
  </>;
}
