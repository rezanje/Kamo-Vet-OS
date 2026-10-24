import { formatPosMoney } from "@/lib/pos-money";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { ClearPosDraft } from "@/components/ClearPosDraft";
import { receiptPaymentRows, saleMerchandiseTotal } from "@/lib/sale-payment-reporting";
import { servicePerformerNames } from "@/lib/service-performers";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = formatPosMoney;

export default async function PosStrukPage({ params, searchParams }: {
  params: Promise<{ saleId: string }>;
  searchParams?: Promise<{ draft_done?: string }>;
}) {
  const { saleId } = await params;
  const checkoutKey = (await searchParams)?.draft_done;
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, cashier_name, subtotal, discount, diskon_kategori, total, merchant_fee_total, metode_bayar, bayar, kembali, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount, fee_percent, fee_amount), poin_earned, created_at, customers(name, customer_categories(nama, diskon_persen)), branches(name, code)")
    .eq("id", saleId).is("channel", null).maybeSingle();
  if (!sale) notFound();
  const paymentRows = receiptPaymentRows(sale);

  const { data: items } = await supabase
    .from("sale_items").select("nama, qty, harga, satuan, service_performers").eq("sale_id", saleId).order("created_at");

  const cust = one(sale.customers) as { name: string; customer_categories?: unknown } | null;
  const branch = one(sale.branches);

  // Diskon golongan dicetak sebagai baris sendiri supaya struk jujur: mana diskon
  // sistem (golongan) dan mana diskon yang diketik kasir.
  const golongan = one((cust?.customer_categories ?? null) as Rel<{ nama: string; diskon_persen: number }>);
  const diskonKategori = Number(sale.diskon_kategori) || 0;
  const tgl = new Date(sale.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {sale.voided_at && <div role="status" className="p2ban">STRUK DIBATALKAN — hanya untuk riwayat</div>}
      <ClearPosDraft checkoutKey={checkoutKey} />
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href="/pos/transaksi" className="back-btn"><i className="ti ti-arrow-left" /> Transaksi baru</Link>
        <PrintButton label="Cetak Struk" />
      </div>

      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>KAMO PET CARE</div>
          <div style={{ fontSize: 9.5 }}>{branch?.name ?? "Petshop"}</div>
        </div>
        <Hr />
        <Row k="No" v={sale.no_struk ?? "-"} />
        <Row k="Tgl" v={tgl} />
        <Row k="Pelanggan" v={cust?.name ?? "Umum"} />
        <Row k="Kasir" v={sale.cashier_name ?? "Kasir belum tercatat (data lama)"} />
        <Hr />
        {(items ?? []).map((it, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{it.nama}</div>
            {it.service_performers != null && <div style={{ fontSize: 9 }}>{servicePerformerNames(it.service_performers).join(" · ")}</div>}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{it.qty}{it.satuan ? ` ${it.satuan}` : ""} x {rp(it.harga)}</span><span>{rp(it.qty * it.harga)}</span>
            </div>
          </div>
        ))}
        <Hr />
        <Row k="Subtotal" v={rp(sale.subtotal)} />
        {diskonKategori > 0 && (
          <Row k={`Diskon ${golongan?.nama ?? "golongan"}`} v={`-${rp(diskonKategori)}`} />
        )}
        {sale.discount > 0 && <Row k="Diskon" v={`-${rp(sale.discount)}`} />}
        {Number(sale.merchant_fee_total) > 0 && <>
          <Row k="Total barang" v={rp(saleMerchandiseTotal(sale))} />
          <Row k="Fee merchant" v={rp(sale.merchant_fee_total)} />
        </>}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}><span>TOTAL</span><span>{rp(sale.total)}</span></div>
        <Hr />
        {paymentRows.map(row => <Row key={row.label} k={row.label} v={rp(row.amount)} />)}
        {Number(sale.kembali) > 0 && <Row k="Kembali" v={rp(sale.kembali)} />}
        {sale.poin_earned > 0 && <Row k="Poin didapat" v={`+${sale.poin_earned}`} />}
        <Hr />
        <div style={{ fontSize: 9 }}>Pelaksana per baris hanya ditampilkan jika tercatat; dokumen lama dapat belum memilikinya.</div>
        <div style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>Terima kasih 🐾<br />Barang dibeli tidak dapat dikembalikan</div>
      </div>
    </>
  );
}

function Hr() { return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />; }
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span>{v}</span></div>;
}
