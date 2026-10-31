import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { DocumentBackLink, RelatedDocuments, type RelatedDocument } from "@/components/RelatedDocuments";
import { bisaBatalReturGrosir } from "@/lib/retur-grosir";
import { ReturGrosirVoidForm } from "./ReturGrosirVoidForm";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export default async function ReturGrosirDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string; from?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const [{ data: profile }, { data: ret, error }] = await Promise.all([
    db.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
    db.from("wholesale_returns")
      .select("id,no_retur,invoice_id,tanggal,alasan,gross,diskon,ppn,total,ar_reduction,customer_credit,hpp,status,revision,journal_id,reversal_journal_id,voided_on,void_reason,created_at,customers(name),warehouses(name),sales_invoices!invoice_id(id,no_faktur,status),wholesale_return_items(id,nama,satuan,qty,harga,gross,diskon,hpp,stocked,exp_date)")
      .eq("id", id).maybeSingle(),
  ]);
  if (error) throw new Error("Retur belum dapat dibaca: " + error.message);
  if (!ret) notFound();
  const journalIds = [ret.journal_id, ret.reversal_journal_id].filter(Boolean);
  const { data: journals } = journalIds.length
    ? await db.from("journal_entries").select("id,no_jurnal").in("id", journalIds)
    : { data: [] as { id: string; no_jurnal: string }[] };
  const noJurnal = new Map(((journals ?? []) as { id: string; no_jurnal: string }[]).map((j) => [j.id, j.no_jurnal]));
  const faktur = one(ret.sales_invoices as Rel<{ id: string; no_faktur: string; status: string }>);
  const items = (ret.wholesale_return_items ?? []) as { id: string; nama: string; satuan: string | null; qty: number; harga: number; gross: number; diskon: number; hpp: number; stocked: boolean; exp_date: string | null }[];
  const terkait: RelatedDocument[] = faktur ? [{ kind: "sales-invoice", id: faktur.id, label: `Faktur ${faktur.no_faktur}`, status: faktur.status }] : [];
  return <>
    <DocumentBackLink from={sp.from} />
    <ActivityHistoryLink entity="wholesale_returns" id={id} />
    <Link className="back-btn" href="/penjualan/retur-grosir">← Retur faktur penjualan</Link>
    <div className="crm-sec">
      <h1 style={{ fontSize: 18 }}>{ret.no_retur} {ret.status === "batal" && <span className="bge r">Dibatalkan</span>}</h1>
      {sp.error && <div className="p2ban" role="alert">{sp.error}</div>}
      {sp.success && <div className="p2ban" role="status">{sp.success}</div>}
      <p>{one(ret.customers as Rel<{ name: string }>)?.name ?? "Tanpa pelanggan"} · {ret.tanggal} · gudang {one(ret.warehouses as Rel<{ name: string }>)?.name ?? "— (jasa saja)"}</p>
      <p>Alasan: {ret.alasan}</p>
      <p>
        Nilai retur {rp(ret.total)} = pendapatan {rp(ret.gross)}{Number(ret.diskon) > 0 ? ` − diskon ${rp(ret.diskon)}` : ""}{Number(ret.ppn) > 0 ? ` + PPN ${rp(ret.ppn)}` : ""}
        · mengurangi piutang {rp(ret.ar_reduction)} · kredit pelanggan {rp(ret.customer_credit)} · modal kembali ke gudang {rp(ret.hpp)}
      </p>
      <p style={{ fontSize: 11 }}>
        Jurnal retur {noJurnal.get(ret.journal_id) ?? ret.journal_id}
        {ret.reversal_journal_id ? ` · jurnal pembatalan ${noJurnal.get(ret.reversal_journal_id) ?? ret.reversal_journal_id}` : ""}
      </p>
      {ret.status === "batal" && <p>Dibatalkan {ret.voided_on}: {ret.void_reason}. Barang keluar lagi dari gudang, jurnal dibalik, dan piutang/kredit dikembalikan.</p>}
      <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>Barang</th><th>Qty</th><th>Harga</th><th>Diskon</th><th>Nilai</th><th>Modal (HPP)</th><th>Kedaluwarsa</th></tr></thead><tbody>
        {items.map((i) => <tr key={i.id}>
          <td>{i.nama}{!i.stocked && <div style={{ fontSize: 10.5, color: "var(--tm)" }}>Jasa/non-stok</div>}</td>
          <td>{Number(i.qty)} {i.satuan}</td><td>{rp(i.harga)}</td><td>{rp(i.diskon)}</td>
          <td>{rp(Number(i.gross) - Number(i.diskon))}</td><td>{rp(i.hpp)}</td><td>{i.exp_date ?? "—"}</td>
        </tr>)}
      </tbody></table></div>
      {ret.status === "posted" && bisaBatalReturGrosir(profile) && user && faktur &&
        <div style={{ marginTop: 12 }}><ReturGrosirVoidForm userId={user.id} returnId={id} invoiceId={faktur.id} revision={Number(ret.revision)} noRetur={ret.no_retur} /></div>}
    </div>
    <RelatedDocuments documents={terkait} from={`/penjualan/retur-grosir/${id}`} note="Faktur sumber retur ini, tersimpan sebagai tautan tetap." />
  </>;
}
