import { servicePerformerNames } from "@/lib/service-performers";
import { formatPosMoney } from "@/lib/pos-money";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton, AutoPrint } from "@/components/PrintButton";
import { lineDiscount } from "@/lib/pos-calc";
import { ClearKasirDraft } from "@/components/ClearKasirDraft";
import { receiptPaymentRows, saleMerchandiseTotal } from "@/lib/sale-payment-reporting";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = formatPosMoney;

export default async function KasirStrukPage({ params, searchParams }: { params: Promise<{ saleId: string }>; searchParams: Promise<{ print?: string; draft_done?: string }> }) {
  const { saleId } = await params;
  const { print, draft_done } = await searchParams;
  const autoPrint = print === "1";
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, cashier_name, cashier_id, branch_id, shift_id, subtotal, discount, total, merchant_fee_total, metode_bayar, bayar, kembali, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount, fee_percent, fee_amount), poin_earned, poin_digunakan, voucher_code, created_at, customers(name), branches(name)")
    .eq("id", saleId).is("channel", null).maybeSingle();
  if (!sale) notFound();
  const paymentRows = receiptPaymentRows(sale);

  const { data: items } = await supabase
    .from("sale_items")
    .select("nama, qty, satuan, service_performers, harga, item_discount_type, item_discount_value, promos(name), sale_item_group_components(component_name, qty_per_group, unit, sort_order)")
    .eq("sale_id", saleId).order("created_at");

  const cust = one(sale.customers);
  const branch = one(sale.branches);
  const tgl = new Date(sale.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {sale.voided_at && <div role="status" className="p2ban">STRUK DIBATALKAN — hanya untuk riwayat</div>}
      <style>{`@media print {
        /* The Windows driver supplies the 58 mm roll size and page length. */
        @page { size: auto; margin: 0; }
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        .pos-topbar, .no-print { display: none !important; }
        .kasir-shell { display: block !important; min-height: 0 !important; height: auto !important; background: #fff !important; }
        .kasir-content { padding: 0 !important; overflow: visible !important; }
        .kasir-receipt { padding: 0 !important; border-radius: 0 !important; }
      }`}</style>
      <ClearKasirDraft
        draftContext={sale.cashier_id && sale.branch_id && sale.shift_id ? `${sale.cashier_id}:${sale.branch_id}:${sale.shift_id}` : undefined}
        checkoutKey={draft_done}
      />
      {autoPrint && <AutoPrint />}

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
        <Link href="/kasir" className="back-btn"><i className="ti ti-arrow-left" /> Transaksi baru</Link>
        <PrintButton label="Cetak Struk" />
      </div>

      <div className="kasir-receipt" style={{ width: "48mm", maxWidth: "100%", boxSizing: "border-box", margin: "0 auto", background: "#fff", padding: "10px 0", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5, borderRadius: 6, overflowWrap: "anywhere" }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>KAMO PETSHOP</div>
          <div style={{ fontSize: 9.5 }}>{branch?.name ?? "Petshop"}</div>
        </div>
        <p style={{fontSize:9}}>Pelaksana per baris hanya ditampilkan jika tercatat; dokumen lama dapat belum memilikinya.</p>
        <Hr />
        <Row k="No" v={sale.no_struk ?? "-"} />
        <Row k="Tgl" v={tgl} />
        <Row k="Kasir" v={sale.cashier_name || "Belum tercatat"} />
        <Row k="Pelanggan" v={cust?.name ?? "Umum"} />
        <Hr />
        {(items ?? []).map((it, i) => {
          // Addendum §6: struk breakdown — potongan per item tampil di bawah barisnya.
          const disc = lineDiscount({ qty: it.qty, harga: it.harga, item_discount_type: it.item_discount_type as "nominal" | "percent" | null, item_discount_value: it.item_discount_value });
          const promo = one(it.promos as Rel<{ name: string }>);
          const components = ([...((it.sale_item_group_components ?? []) as {
            component_name: string; qty_per_group: number; unit: string; sort_order: number;
          }[])]).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
          return (
            <div key={i} style={{ marginBottom: 3 }}>
              <div>{it.nama}</div>
              {it.service_performers && servicePerformerNames(it.service_performers).map(name => <div key={name} style={{fontSize:9.5}}>{name}</div>)}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 4, alignItems: "start" }}>
                {/* Satuan ikut tercetak (permintaan Bu Nisa, meeting 14 Agustus):
                    "2 x 35.000" tidak memberi tahu 2 botol atau 2 dus. */}
                <span style={{ minWidth: 0 }}>{it.qty} {it.satuan || "pcs"} x {rp(it.harga)}</span><span style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{rp(it.qty * it.harga)}</span>
              </div>
              {components.map((component) => (
                <div key={`${component.sort_order}-${component.component_name}`} style={{ paddingLeft: 10, fontSize: 9.5 }}>
                  ↳ {Number(it.qty) * Number(component.qty_per_group)} {component.unit} {component.component_name}
                </div>
              ))}
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
        <div style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>Terima kasih 🐾<br />Barang dibeli tidak dapat dikembalikan</div>
      </div>
    </>
  );
}

function Hr() { return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />; }
function Row({ k, v }: { k: string; v: string }) {
  const money = /^-?Rp /.test(v);
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 4, alignItems: "start" }}>
    <span style={{ minWidth: 0, ...(money ? { flex: "1 1 0" } : { flexShrink: 0, maxWidth: "40%" }) }}>{k}</span>
    <span style={{ minWidth: 0, textAlign: "right", ...(money ? { flexShrink: 0, whiteSpace: "nowrap" as const } : {}) }}>{v}</span>
  </div>;
}
