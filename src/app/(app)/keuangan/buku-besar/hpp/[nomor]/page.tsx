import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { rincianHppFaktur } from "@/lib/hpp-rincian";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type Rincian = { nama: string; qty: number; satuan: string; hpp: number };

export default async function RincianHppPage({ params }: { params: Promise<{ nomor: string }> }) {
  const nomor = decodeURIComponent((await params).nomor);
  const supabase = await createClient();

  const { data: sale } = await supabase
    .from("sales")
    .select("id, no_struk, sale_items(nama, qty, satuan, hpp)")
    .eq("no_struk", nomor).maybeSingle();

  let sourceHref = sale ? `/pos/struk/${sale.id}` : "";
  let isAlokasiFaktur = false;
  let rows: Rincian[] = sale
    ? (sale.sale_items ?? []).map((item) => ({
      nama: item.nama, qty: Number(item.qty), satuan: item.satuan || "pcs", hpp: Number(item.hpp) || 0,
    }))
    : [];

  if (!sale) {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("visit_id, invoice_no, invoice_items(deskripsi, qty, hpp)")
      .eq("invoice_no", nomor).maybeSingle();
    if (invoice) {
      sourceHref = `/klinik/pembayaran/${invoice.visit_id}`;
      rows = (invoice.invoice_items ?? []).map((item) => ({
        nama: item.deskripsi, qty: Number(item.qty), satuan: "unit", hpp: Number(item.hpp) || 0,
      }));
    }
  }

  if (!sale && rows.length === 0) {
    const { data: delivery } = await supabase
      .from("sales_deliveries")
      .select("order_id, no_kirim, sales_delivery_items(nama, qty, satuan, hpp)")
      .eq("no_kirim", nomor).maybeSingle();
    if (delivery) {
      sourceHref = `/penjualan/pesanan/${delivery.order_id}`;
      rows = (delivery.sales_delivery_items ?? []).map((item) => ({
        nama: item.nama, qty: Number(item.qty), satuan: item.satuan || "unit", hpp: Number(item.hpp) || 0,
      }));
    }
  }

  if (!sale && rows.length === 0) {
    const { data: invoice } = await supabase
      .from("sales_invoices")
      .select("order_id, no_faktur, sales_invoice_items(order_item_id, nama, qty, satuan, hpp)")
      .eq("no_faktur", nomor).maybeSingle();
    if (invoice?.order_id) {
      const invoiceItems = invoice.sales_invoice_items ?? [];
      const hasSnapshot = invoiceItems.every((item) => item.hpp !== null);
      if (hasSnapshot) {
        rows = invoiceItems.map((item) => ({
          nama: item.nama,
          qty: Number(item.qty),
          satuan: item.satuan || "unit",
          hpp: Number(item.hpp) || 0,
        }));
      } else {
        const { data: deliveries } = await supabase
          .from("sales_deliveries")
          .select("sales_delivery_items(order_item_id, qty, hpp)")
          .eq("order_id", invoice.order_id);
        rows = rincianHppFaktur(invoiceItems.map((item) => ({
          orderItemId: item.order_item_id,
          nama: item.nama,
          qty: Number(item.qty),
          satuan: item.satuan,
        })),
          (deliveries ?? []).flatMap((delivery) => (delivery.sales_delivery_items ?? []).map((item) => ({
            orderItemId: item.order_item_id,
            qty: Number(item.qty),
            hpp: item.hpp === null ? null : Number(item.hpp),
          }))),
        );
      }
      sourceHref = `/penjualan/pesanan/${invoice.order_id}`;
      isAlokasiFaktur = true;
    }
  }

  if (!sourceHref) notFound();

  const total = rows.reduce((sum, row) => sum + row.hpp, 0);
  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href="/keuangan/buku-besar?akun=5101" className="back-btn"><i className="ti ti-arrow-left" /> Buku Besar HPP</Link>
      <Link href={sourceHref} className="back-btn">Buka transaksi</Link>
    </div>
    <div className="crm-sec">
      <SecHeader
        num="01"
        title={`RINCIAN HPP — ${nomor}`}
        desc={isAlokasiFaktur
          ? "Modal per barang untuk faktur ini, dialokasikan dari modal barang yang sudah dikirim."
          : "Modal barang per transaksi. Angka pelanggan tetap terpisah dari rincian internal ini."}
      />
      <table className="tbl">
        <thead><tr><th>Barang</th><th style={{ textAlign: "right" }}>Qty</th><th>Satuan</th><th style={{ textAlign: "right" }}>HPP</th></tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={`${row.nama}-${index}`}><td>{row.nama}</td><td style={{ textAlign: "right" }}>{row.qty}</td><td>{row.satuan}</td><td style={{ textAlign: "right" }}>{rp(row.hpp)}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: 16 }}>Belum ada rincian HPP.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={3} style={{ fontWeight: 700 }}>Total HPP</td><td style={{ textAlign: "right", fontWeight: 700 }}>{rp(total)}</td></tr></tfoot>
      </table>
    </div>
  </>;
}
