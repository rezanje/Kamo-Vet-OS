import { printBranchHeading } from "@/components/print-branch-heading";
import { formatPosMoney } from "@/lib/pos-money";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { ClearPosDraft } from "@/components/ClearPosDraft";
import { receiptPaymentRows, saleMerchandiseTotal } from "@/lib/sale-payment-reporting";
import { pesanPilihanPromo } from "@/lib/promo-pick-note";
import { lineDiscount, linePromoApplied, type CartLine } from "@/lib/pos-calc";
import { labelDiskonManual, labelPromo } from "@/lib/label-potongan";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = formatPosMoney;
/** Satu baris struk tersimpan dalam bentuk yang dimengerti lib/pos-calc (sama dengan struk kasir). */
type BarisTersimpan = { qty: number; harga: number; item_discount_type?: string | null; item_discount_value?: number | null; promo_discount?: number | null };
const barisStruk = (it: BarisTersimpan): CartLine => ({
  qty: Number(it.qty), harga: Number(it.harga),
  item_discount_type: (it.item_discount_type as "nominal" | "percent" | null) ?? null,
  item_discount_value: Number(it.item_discount_value) || 0,
  promo_discount: Number(it.promo_discount) || 0,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SaleRead = { data: any; error: { code?: string } | null };

export default async function PosStrukPage({ params, searchParams }: {
  params: Promise<{ saleId: string }>;
  searchParams?: Promise<{ draft_done?: string }>;
}) {
  const { saleId } = await params;
  const checkoutKey = (await searchParams)?.draft_done;
  const supabase = await createClient();

  const SALE_COLUMNS = "id, no_struk, cashier_name, subtotal, discount, diskon_kategori, total, merchant_fee_total, metode_bayar, bayar, kembali, payment_plan, payments_finalized_at, voided_at, sale_payments(method, amount, fee_percent, fee_amount), poin_earned, created_at, customers(name, customer_categories(nama, diskon_persen)), branches(name, code)";
  // Kolom dipilih dari string yang dirakit: hasilnya sengaja tidak bertipe (dibaca persis seperti sebelumnya).
  const readSale = (columns: string) => supabase.from("sales").select(columns).eq("id", saleId).is("channel", null).maybeSingle() as unknown as Promise<SaleRead>;
  // Pilihan promo kasir (kolom promo_pick_mode/promo_selection): bila kolomnya belum ada di database struk tetap dicetak tanpa catatan, bukan 404.
  const first = await readSale(`${SALE_COLUMNS}, promo_pick_mode, promo_selection`);
  const sale = !first.data && (first.error?.code === "42703" || first.error?.code === "PGRST204") ? (await readSale(SALE_COLUMNS)).data : first.data;
  if (!sale) notFound();
  const paymentRows = receiptPaymentRows(sale);
  const catatanPromo = pesanPilihanPromo(sale.promo_pick_mode, sale.promo_selection);

  const { data: items } = await supabase
    .from("sale_items").select("nama, qty, harga, satuan, item_discount_type, item_discount_value, promo_discount, promos(name)").eq("sale_id", saleId).order("created_at");
  // Reza 8 Nov: potongan per barang (promo) dicetak di bawah barangnya; bagian bawah khusus
  // diskon transaksi. Potongan promo sudah termasuk di sale.discount, jadi dikurangkan di sana.
  const itemDisc = (items ?? []).reduce((a, it) => a + lineDiscount(barisStruk(it)), 0);
  const diskonTransaksi = Math.max(0, Number(sale.discount) - itemDisc);

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
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>{printBranchHeading(branch)}</div>
        </div>
        <Hr />
        <Row k="No" v={sale.no_struk ?? "-"} />
        <Row k="Tgl" v={tgl} />
        <Row k="Pelanggan" v={cust?.name ?? "Umum"} />
        <Row k="Kasir" v={sale.cashier_name ?? "Kasir belum tercatat (data lama)"} />
        <Hr />
        {(items ?? []).map((it, i) => {
          const disc = lineDiscount(barisStruk(it));
          const promo = linePromoApplied(barisStruk(it)) > 0 ? one(it.promos as Rel<{ name: string }>) : null;
          return (
            <div key={i} style={{ marginBottom: 3 }}>
              <div>{it.nama}</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{it.qty}{it.satuan ? ` ${it.satuan}` : ""} x {rp(it.harga)}</span><span>{rp(it.qty * it.harga)}</span>
              </div>
              {disc > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                  <span>&nbsp;&nbsp;{promo ? labelPromo(promo.name) : labelDiskonManual(it.item_discount_type === "percent" ? Number(it.item_discount_value) : null)}</span>
                  <span>-{rp(disc)}</span>
                </div>
              )}
            </div>
          );
        })}
        <Hr />
        <Row k="Subtotal" v={rp(Number(sale.subtotal) - itemDisc)} />
        {diskonKategori > 0 && (
          <Row k={`Diskon ${golongan?.nama ?? "golongan"}`} v={`-${rp(diskonKategori)}`} />
        )}
        {diskonTransaksi > 0 && <Row k="Diskon transaksi" v={`-${rp(diskonTransaksi)}`} />}
        {catatanPromo && <div data-testid="struk-catatan-promo" style={{ fontSize: 10, margin: "2px 0" }}>{catatanPromo}</div>}
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
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span>{v}</span></div>;
}
