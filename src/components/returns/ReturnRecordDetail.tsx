import Link from "next/link";
import { DocumentLink } from "@/components/RelatedDocuments";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReturnCorrectionForm, type CorrectionReturnLine } from "./ReturnCorrectionForm";

export async function ReturnRecordDetail({ kind, id, error, success }: {
  kind: "sales" | "purchase"; id: string; error?: string; success?: string;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await createClient();
  const base = kind === "sales" ? "/penjualan/retur" : "/pembelian/retur";
  const table = kind === "sales" ? "sales_returns" : "purchase_returns";
  const itemTable = kind === "sales" ? "sales_return_items" : "purchase_return_items";
  const { data: { user } } = await db.auth.getUser();
  if (!user) notFound();
  const [document, items, profile, provenance, audit, parent] = await Promise.all([
    db.from(table).select("*").eq("id", id).maybeSingle(),
    db.from(itemTable).select("*").eq("return_id", id),
    db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle(),
    db.from("return_record_postings").select("return_id,snapshot").eq("kind", kind).eq("return_id", id).maybeSingle(),
    db.from("return_record_corrections").select("*").eq("kind", kind).eq("return_id", id).maybeSingle(),
    db.from("return_record_corrections").select("return_id").eq("kind", kind).eq("replacement_id", id).maybeSingle(),
  ]);
  if ([document, items, profile, provenance, audit, parent].some(result => result.error)) throw new Error("Rincian retur dan audit belum dapat dimuat.");
  const record = document.data;
  if (!record) notFound();
  const relatedInvoices = kind === "purchase" && record.po_id
    ? await db.from("purchase_invoices").select("id,no_faktur,voided_at").eq("po_id", record.po_id)
    : { data: [], error: null };
  const rows = (items.data ?? []) as CorrectionReturnLine[];
  const owner = profile.data?.role === "OWNER" && profile.data.is_active;
  type Payout={method:"Tunai"|"Transfer";amount:number;account_name:string;expense_id:string;request_id:string|null};
  const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  let payout:Payout|null=null,payoutUnknown=false;
  if(kind==="sales")try{
    const result=await db.rpc("get_sales_return_payout",{p_return:id});
    if(!result||result.error||result.data===undefined)throw Error("Unconfirmed payout");
    if(result.data!==null){
      const p=result.data as Payout;
      if(!p||!["Tunai","Transfer"].includes(p.method)||!Number.isFinite(p.amount)||p.amount<=0||p.amount!==Number(record.total)||typeof p.account_name!=="string"||!p.account_name.trim()||!uuid(p.expense_id)||(p.request_id!==null&&!uuid(p.request_id))||(p.method==="Transfer"&&p.request_id===null))throw Error("Invalid payout proof");
      payout=p;
    }
  }catch{payoutUnknown=true;}
  const canCorrect = owner && !record.voided_at && provenance.data && !payoutUnknown && !payout;
  const journals = (provenance.data?.snapshot?.journals ?? []) as { id: string; no_jurnal: string }[];
  return <>
    <Link className="back-btn" href={base}>Kembali ke daftar retur</Link>
    <h2>{record.no_retur}</h2>
    {error && <div className="p2ban" role="alert">{error}</div>}
    {success && <div className="p2ban" role="status">Koreksi tersimpan. Dokumen asal dan audit tetap tersedia.</div>}
    <div className="crm-sec">
      <p>{record.voided_at ? "Dibatalkan / diganti" : "Aktif"} · {record.tanggal} · Revisi {record.revision}</p>
      <p>Nilai dokumen: Rp {Number(record.total).toLocaleString("id-ID")} · {record.keterangan}</p>
      {kind === "purchase" && record.po_id && <p><DocumentLink kind="purchase-order" id={record.po_id} from={`${base}/${id}`}>Pesanan pembelian asal</DocumentLink></p>}
      {kind === "purchase" && record.po_id && <div>
        <p>Faktur berikut memakai PO yang sama; alokasi retur ke faktur tertentu tidak tersimpan.</p>
        {relatedInvoices.error && <p role="alert">Faktur pada PO yang sama belum dapat dimuat. Coba muat ulang.</p>}
        {(relatedInvoices.data ?? []).map(invoice => <p key={invoice.id}><DocumentLink kind="purchase-invoice" id={invoice.id} from={`${base}/${id}`}>Faktur pada PO yang sama {invoice.no_faktur}</DocumentLink>{invoice.voided_at ? " · dibatalkan" : ""}</p>)}
      </div>}
      {kind === "sales" && record.sale_id && <p><Link href={`/penjualan/${record.sale_id}`}>Penjualan asal</Link></p>}
      {parent.data && <p>Pengganti dari <Link href={`${base}/${parent.data.return_id}`}>dokumen asal</Link></p>}
      {rows.map(row => <p key={row.id}>{row.nama} · {Number(row.selected_qty ?? row.qty ?? 0)} {row.satuan ?? "satuan dasar"}</p>)}
      <p>Jurnal asal: {journals.length ? journals.map(j => j.no_jurnal).join(", ") : "Provenance lama belum tersedia"}</p>
    </div>
    {payoutUnknown&&<p role="alert">Bukti payout belum dapat diperiksa. Koreksi ditahan; muat ulang dan periksa bukti refund sebelum mencoba lagi.</p>}
    {payout&&<section className="crm-sec"><h3>Payout refund tersimpan</h3>
      <p>{payout.method} · {payout.account_name} · Rp {payout.amount.toLocaleString("id-ID",{maximumFractionDigits:2})}</p>
      <p>Koreksi otomatis ditahan untuk payout akun terpilih. Periksa bukti refund bersama Finance sebelum membalik uang atau stok.</p>
      {payout.request_id&&["OWNER","ADMIN","FINANCE"].includes(profile.data?.role??"")&&<Link href="/kas-bank/refund?status=selesai">Buka antrean refund selesai</Link>}
    </section>}
    {audit.data && <div className="crm-sec">
      <h3>Audit koreksi</h3>
      <p>{audit.data.created_at} · Pengguna {audit.data.created_by}</p>
      <p>{audit.data.reason}</p><p>Bukti fisik: {audit.data.physical_evidence}</p>
      <p>Jurnal pembalik: {(audit.data.reversal_journal_ids as string[]).join(", ")}</p>
      {audit.data.replacement_id && <Link href={`${base}/${audit.data.replacement_id}`}>Lihat catatan pengganti</Link>}
    </div>}
    {owner && !record.voided_at && !provenance.data && <p role="alert">Retur lama belum memiliki tautan pasti ke stok, jurnal, dan refund. Koreksi otomatis diblokir; rekonsiliasi bukti sumber diperlukan.</p>}
    {canCorrect && <div className="crm-sec"><h3>Koreksi catatan retur</h3>
      <ReturnCorrectionForm key={`${user.id}:${id}:${record.revision}`} userId={user.id} kind={kind} id={id} revision={record.revision} rows={rows} />
    </div>}
  </>;
}
