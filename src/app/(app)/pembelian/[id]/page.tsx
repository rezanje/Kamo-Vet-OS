import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { DocumentBackLink, RelatedDocuments, type RelatedDocument } from "@/components/RelatedDocuments";
import { loadUnitOptions } from "@/lib/satuan";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";
import { POEditForm, POCancelForm } from "./POCorrectionForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" });

const BADGE: Record<string, string> = { Draft: "x", Dikirim: "b", Dipesan: "b", Diterima: "g", Batal: "r" };

type PO = {
  id: string;
  no_po: string | null;
  tanggal: string;
  status: string;
  total: number;
  revision: number;
  supplier_id: string | null;
  to_warehouse_id: string;
  suppliers: Rel<{ nama: string }>;
  warehouses: Rel<{ name: string }>;
  branches: Rel<{ name: string }>;
  goods_receipts?: { id: string; no_terima: string; tanggal: string }[] | null;
  po_payments?: { id: string; tanggal: string; amount: number; metode: string }[] | null;
  purchase_returns?: { id: string; no_retur: string; voided_at: string | null }[] | null;
  purchase_advances?: { id: string; no_um: string; status: string }[] | null;
  purchase_order_items: {
    id: string; item_id: string | null; nama: string; qty: number; satuan: string | null; faktor: number;
    qty_terima: number | null; harga_beli: number;
  }[] | null;
};

export default async function PODetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string; from?: string }>;
}) {
  const { id } = await params;
  const { success, error, from } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error: poError } = await supabase.from("purchase_orders").select("id, no_po, tanggal, status, total, revision, supplier_id, to_warehouse_id, branch_id, suppliers(nama), warehouses(name), branches(name), purchase_order_items(id, item_id, nama, qty, satuan, faktor, qty_terima, harga_beli), goods_receipts(id,no_terima,tanggal), po_payments(id,tanggal,amount,metode), purchase_returns(id,no_retur,voided_at), purchase_advances(id,no_um,status)").eq("id", id).maybeSingle();
  const po = data as unknown as (PO & { branch_id: string }) | null;
  if (poError) throw new Error("PO dan transaksi terkait belum dapat dimuat. Coba muat ulang.");
  if (!po) notFound();

  const [{ data: suppliers }, { data: warehouses }, { data: profile }, { data: invoices, error: invoiceError }] = await Promise.all([
    supabase.from("suppliers").select("id, nama").order("nama"),
    supabase.from("warehouses").select("id, name, branch_id").eq("branch_id", po.branch_id).eq("is_active", true).order("name"),
    supabase.from("profiles").select("role,is_active").eq("id", user?.id ?? "").maybeSingle(),
    supabase.from("purchase_invoices").select("id,no_faktur,voided_at").eq("po_id", id).order("tanggal", { ascending: false }),
  ]);

  const items = po.purchase_order_items ?? [];
  const owner = !!user && profile?.role === "OWNER" && profile.is_active;
  const hasChildren = items.some(item => Number(item.qty_terima) > 0) || (po.goods_receipts?.length ?? 0) > 0
    || (po.po_payments?.length ?? 0) > 0 || (po.purchase_returns?.length ?? 0) > 0 || (po.purchase_advances?.length ?? 0) > 0 || (invoices?.length ?? 0) > 0;
  const editable = owner && !invoiceError && !hasChildren && (po.status === "Draft" || po.status === "Dipesan");
  const units = editable ? Object.fromEntries(await loadUnitOptions(supabase, items.flatMap(item => item.item_id ? [item.item_id] : []), { includeInactive: true })) : {};

  const related: RelatedDocument[] = [
    ...(po.goods_receipts ?? []).map(r => ({ kind: 'goods-receipt' as const, id: r.id, label: `Penerimaan ${r.no_terima}`, status: 'Dokumen tersimpan' })),
    ...(invoices ?? []).map(r => ({ kind: 'purchase-invoice' as const, id: r.id, label: `Faktur ${r.no_faktur}`, status: r.voided_at ? 'Dibatalkan' : 'Aktif' })),
    ...(po.po_payments ?? []).map(p => ({kind:'legacy-purchase-payment' as const,id:p.id,parentId:po.id,label:`Pembayaran PO ${p.tanggal} · ${rp(p.amount)}`,status:'Dokumen lama; alokasi faktur tidak tersimpan'})),
    ...(po.purchase_returns ?? []).map(r => ({kind:'purchase-return' as const,id:r.id,label:`Retur ${r.no_retur}`,status:r.voided_at?'Dibatalkan':'Tersimpan'})),
    ...(po.purchase_advances ?? []).map(r => ({ kind: 'purchase-advance' as const, id: r.id, label: `Uang muka ${r.no_um}`, status: r.status })),
  ];

  return (
    <>
      <DocumentBackLink from={from} />
      <ActivityHistoryLink entity="purchase_orders" id={id} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/pembelian" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{po.no_po ?? "Purchase Order"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {editable && <><a href="#edit-po" className="btn-def">Edit PO</a><a href="#cancel-po" className="btn-def" style={{ color: "#b91c1c" }}>Batalkan PO</a></>}
        {owner && (hasChildren || po.status === "Diterima") && <a href="#purchase-correction" className="btn-def">Koreksi pembelian</a>}
        {po.status !== "Diterima" && po.status !== "Batal" && (
          <Link href={`/pembelian/${po.id}/terima`} className="btn-acc" style={{ textDecoration: "none" }}>
            <i className="ti ti-package-import" /> Terima barang
          </Link>
        )}
        </div>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Dokumen tersimpan.
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{po.no_po ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtTgl(po.tanggal)}</div>
          </div>
          <span className={`bge ${BADGE[po.status] ?? "x"}`} style={{ fontSize: 11, padding: "4px 12px" }}>{po.status}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Info label="Supplier" value={one(po.suppliers)?.nama ?? "—"} />
          <Info label="Gudang tujuan" value={one(po.warehouses)?.name ?? "—"} />
          <Info label="Cabang" value={one(po.branches)?.name ?? "—"} />
          <Info label="Total PO" value={rp(Number(po.total))} />
        </div>
      </div>

      <RelatedDocuments documents={related} from={`/pembelian/${po.id}`} error={!!invoiceError} />

      <div className="crm-sec">
        <SecHeader num="01" title="DAFTAR ITEM" desc="Barang, satuan, jumlah dipesan & diterima." />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 660 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>No.</th>
                <th>Nama Barang</th>
                <th>Satuan</th>
                <th style={{ textAlign: "center" }}>Qty PO</th>
                <th style={{ textAlign: "center" }}>Qty Diterima</th>
                <th style={{ textAlign: "right" }}>Harga</th>
                <th style={{ textAlign: "right" }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{it.satuan ?? "—"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{Number(it.qty)}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{it.qty_terima != null ? Number(it.qty_terima) : "—"}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.harga_beli))}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(it.qty) * Number(it.harga_beli))}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada item.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editable && user && (
        <div className="crm-sec" id="edit-po">
          <SecHeader num="02" title="KOREKSI PO" desc="Hanya Super Admin yang dapat mengubah atau membatalkan PO sebelum ada transaksi turunan." />
          <POEditForm unitOptions={units} userId={user.id} poId={po.id} revision={po.revision} supplierId={po.supplier_id ?? ""} warehouseId={po.to_warehouse_id} tanggal={po.tanggal} rows={items} suppliers={(suppliers ?? []) as { id: string; nama: string }[]} warehouses={(warehouses ?? []) as { id: string; name: string }[]} />
          <div id="cancel-po" style={{ borderTop: ".5px solid var(--bd)", marginTop: 14, paddingTop: 12 }}>
            <POCancelForm userId={user.id} poId={po.id} revision={po.revision} />
          </div>
        </div>
      )}

      {(hasChildren || po.status === "Diterima" || invoiceError) && <div className="crm-sec" id="purchase-correction">
        <SecHeader num="02" title="KOREKSI PEMBELIAN" desc="PO dengan transaksi turunan mempertahankan riwayat penerimaan, stok, dan pembukuan." />
        <p style={{ fontSize: 11, color: "var(--tm)" }}>PO ini sudah memiliki transaksi turunan. Koreksi harga beli atau HPP melalui faktur pembelian. Untuk kesalahan jumlah atau satuan barang yang sudah diterima, periksa penerimaan dan stok bersama Super Admin sebelum membuat retur atau PO baru.</p>
        {invoiceError ? <p role="alert" className="p2ban">Faktur terkait belum dapat dimuat. Muat ulang sebelum mengoreksi pembelian.</p> : (invoices ?? []).length > 0 ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(invoices ?? []).map(invoice => <Link key={invoice.id} className="btn-def" href={`/pembelian/faktur/${invoice.id}`}>{owner ? "Koreksi faktur" : "Lihat faktur"} {invoice.no_faktur}{invoice.voided_at ? " (dibatalkan)" : ""}</Link>)}
        </div> : <><p style={{ fontSize: 11, color: "var(--tm)" }}>Belum ada faktur untuk PO ini.</p>{po.status === "Diterima" && <Link className="btn-def" href="/pembelian/faktur/baru">Buat faktur dari PO</Link>}</>}
        {owner && <p style={{ fontSize: 11, color: "var(--tm)" }}>Di detail faktur, gunakan Batalkan faktur atau Batalkan &amp; siapkan pengganti. Pembayaran yang sudah ada harus dibalik terlebih dahulu.</p>}
      </div>}

      {(po.po_payments?.length ?? 0) > 0 && <section className="crm-sec"><h2 style={{ fontSize: 14 }}>Pembayaran PO lama</h2><p>Alokasi ke faktur tidak tersimpan; pembayaran ini tidak dianggap pelunasan faktur tertentu.</p>{po.po_payments!.map(p => <article id={`legacy-payment-${p.id}`} key={p.id}><p>{p.tanggal} · {rp(p.amount)} · {p.metode}</p></article>)}</section>}
      <DokumenPanel modul="pembelian" refId={po.id} kembali={`/pembelian/${po.id}`} />
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
