import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton, AutoPrint } from "@/components/PrintButton";
import { lineDiscount } from "@/lib/pos-calc";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function KasirStrukPage({ params, searchParams }: { params: Promise<{ saleId: string }>; searchParams: Promise<{ print?: string }> }) {
  const { saleId } = await params;
  const autoPrint = (await searchParams).print === "1";
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, subtotal, discount, total, metode_bayar, bayar, kembali, poin_earned, poin_digunakan, voucher_code, created_at, customers(name), branches(name)")
    .eq("id", saleId).maybeSingle();
  if (!sale) notFound();

  const { data: items } = await supabase
    .from("sale_items")
    .select("nama, qty, harga, item_discount_type, item_discount_value, promos(name)")
    .eq("sale_id", saleId).order("created_at");

  const cust = one(sale.customers);
  const branch = one(sale.branches);
  const tgl = new Date(sale.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } .pos-topbar { display: none !important; } }`}</style>
      {autoPrint && <AutoPrint />}

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
        <Link href="/kasir" className="back-btn"><i className="ti ti-arrow-left" /> Transaksi baru</Link>
        <PrintButton label="Cetak Struk" />
      </div>

      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5, borderRadius: 6 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>KAMO PETSHOP</div>
          <div style={{ fontSize: 9.5 }}>{branch?.name ?? "Petshop"}</div>
        </div>
        <Hr />
        <Row k="No" v={sale.no_struk ?? "-"} />
        <Row k="Tgl" v={tgl} />
        <Row k="Pelanggan" v={cust?.name ?? "Umum"} />
        <Hr />
        {(items ?? []).map((it, i) => {
          // Addendum §6: struk breakdown — potongan per item tampil di bawah barisnya.
          const disc = lineDiscount({ qty: it.qty, harga: it.harga, item_discount_type: it.item_discount_type as "nominal" | "percent" | null, item_discount_value: it.item_discount_value });
          const promo = one(it.promos as Rel<{ name: string }>);
          return (
            <div key={i} style={{ marginBottom: 3 }}>
              <div>{it.nama}</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{it.qty} x {rp(it.harga)}</span><span>{rp(it.qty * it.harga)}</span>
              </div>
              {disc > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                  <span>&nbsp;&nbsp;Pot. {promo?.name ?? "item"}{it.item_discount_type === "percent" ? ` ${Number(it.item_discount_value)}%` : ""}</span>
                  <span>-{rp(disc)}</span>
                </div>
              )}
            </div>
          );
        })}
        <Hr />
        {(() => {
          const itemDisc = (items ?? []).reduce((a, it) => a + lineDiscount({ qty: it.qty, harga: it.harga, item_discount_type: it.item_discount_type as "nominal" | "percent" | null, item_discount_value: it.item_discount_value }), 0);
          const txnDisc = Math.max(0, Number(sale.discount) - itemDisc - Number(sale.poin_digunakan));
          return (
            <>
              <Row k="Subtotal" v={rp(sale.subtotal)} />
              {itemDisc > 0 && <Row k="Pot. per item" v={`-${rp(itemDisc)}`} />}
              {txnDisc > 0 && <Row k={sale.voucher_code ? `Diskon + voucher ${sale.voucher_code}` : "Diskon transaksi"} v={`-${rp(txnDisc)}`} />}
              {!txnDisc && sale.voucher_code ? <Row k={`Voucher ${sale.voucher_code}`} v="✓" /> : null}
              {sale.poin_digunakan > 0 && <Row k="Poin dipakai" v={`-${rp(sale.poin_digunakan)}`} />}
            </>
          );
        })()}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}><span>TOTAL</span><span>{rp(sale.total)}</span></div>
        <Hr />
        <Row k={sale.metode_bayar} v={rp(sale.bayar)} />
        {sale.metode_bayar === "Tunai" && <Row k="Kembali" v={rp(sale.kembali)} />}
        {sale.poin_earned > 0 && <Row k="Poin didapat" v={`+${sale.poin_earned}`} />}
        <Hr />
        <div style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>Terima kasih 🐾<br />Barang dibeli tidak dapat dikembalikan</div>
      </div>
    </>
  );
}

function Hr() { return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />; }
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span>{v}</span></div>;
}
