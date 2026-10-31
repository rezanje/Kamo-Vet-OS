import Link from "next/link";
import Decimal from "decimal.js";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { readCompleteList } from "@/lib/checked-list";
import { PrintButton } from "@/components/PrintButton";
import styles from "./TransferPrint.module.css";

type Warehouse = { code: string; name: string };
type Transfer = {
  id: string; no_pemindahan: string; proses: string; tanggal: string; status: string;
  keterangan: string | null; cancelled_at: string | null; cancel_reason: string | null;
  from: Warehouse | null; to: Warehouse | null;
};
type Line = {
  id: string; item_id: string; qty: string; selected_qty: string | null; satuan: string | null; faktor: number | null;
  items: { code: string; name: string; unit: string } | { code: string; name: string; unit: string }[] | null;
};

function isPositiveQuantity(value: string): boolean {
  try {
    const quantity = new Decimal(value);
    return quantity.isFinite() && quantity.gt(0);
  } catch {
    return false;
  }
}

function formatQuantity(value: string): string {
  // No decimal-place argument: retain all saved digits without exponent notation.
  return new Decimal(value).toFixed().replace(".", ",");
}

// Read-only output of the existing shipment. Printing never invokes a stock or sales writer.
export default async function TransferPrintPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ rangkap?: string }>;
}) {
  const { id } = await params;
  const { rangkap } = await searchParams;
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) redirect("/login");
  const { data, error } = await db.from("stock_transfers").select(
    "id,no_pemindahan,proses,tanggal,status,keterangan,cancelled_at,cancel_reason," +
    "from:warehouses!stock_transfers_from_warehouse_id_fkey(code,name)," +
    "to:warehouses!stock_transfers_to_warehouse_id_fkey(code,name)",
  ).eq("id", id).maybeSingle();
  if (error) return <p role="alert">Dokumen pemindahan belum dapat dibaca. Cetak ditahan; muat ulang.</p>;
  if (!data) notFound();
  const doc = data as unknown as Transfer;
  if (doc.proses !== "Kirim Barang") notFound();
  let lines: Line[];
  try {
    lines = await readCompleteList<Line>((from, to) => db.from("stock_transfer_items")
      .select("id,item_id,qty::text,selected_qty::text,satuan,faktor,items(code,name,unit)", { count: "exact" })
      .eq("transfer_id", id).order("id").range(from, to), "Rincian pemindahan");
  } catch {
    return <p role="alert">Rincian pemindahan belum dapat dibaca lengkap. Cetak ditahan; muat ulang.</p>;
  }
  if (!lines.length || !doc.from?.name || !doc.to?.name || lines.some(line => {
    const item = Array.isArray(line.items) ? line.items[0] : line.items;
    return !item?.code || !item.name || !item.unit || !isPositiveQuantity(line.qty)
      || (line.selected_qty !== null && !isPositiveQuantity(line.selected_qty));
  })) return <p role="alert">Data pemindahan belum lengkap atau jumlah barang tidak valid. Cetak ditahan; periksa dokumen.</p>;
  const copies = rangkap === "2" ? ["Gudang", "Toko"] : ["Gudang", "Pengantar", "Toko"];
  const cancelled = doc.status === "Dibatalkan" || !!doc.cancelled_at;
  return <>
    <div className={`${styles.controls} no-print`}>
      <Link href={`/pos/pemindahan/${encodeURIComponent(doc.id)}`}>← Kembali ke pemindahan</Link>
      <form method="get">
        <label>Jumlah rangkap <select name="rangkap" defaultValue={String(copies.length)} aria-label="Jumlah rangkap">
          <option value="2">2 rangkap</option><option value="3">3 rangkap</option>
        </select></label>{" "}
        <button type="submit" className="btn-def">Tampilkan</button>
      </form>
      <PrintButton />
      <p>PDF sudah berisi {copies.length} rangkap. Pilih 1 salinan pada dialog cetak agar tidak tercetak ganda.</p>
    </div>
    {copies.map((copy, index) => <article className={styles.sheet} data-transfer-copy={copy} key={copy}>
      {cancelled && <div className={styles.cancelled} data-transfer-cancelled="true"><strong>DIBATALKAN — BUKAN BUKTI PENGIRIMAN AKTIF</strong>
        {doc.cancel_reason && <p>Alasan: {doc.cancel_reason}</p>}
      </div>}
      <header className={styles.header}>
        <div><strong>KAMO</strong><h1>SURAT JALAN PEMINDAHAN BARANG</h1></div>
        <span>Lembar {index + 1} — {copy}</span>
      </header>
      <p className={styles.disclaimer}>Dokumen pemindahan internal — bukan faktur penjualan.</p>
      <dl className={styles.meta}>
        <div><dt>Nomor</dt><dd>{doc.no_pemindahan}</dd></div>
        <div><dt>Tanggal</dt><dd>{doc.tanggal}</dd></div>
        <div><dt>Dari gudang</dt><dd>{doc.from?.name} ({doc.from?.code})</dd></div>
        <div><dt>Ke toko/gudang</dt><dd>{doc.to?.name} ({doc.to?.code})</dd></div>
        <div><dt>Status sistem</dt><dd>{doc.status}</dd></div>
      </dl>
      <table className={styles.items}>
        <thead><tr><th>No.</th><th>Kode barang</th><th>Nama barang</th><th>Jumlah</th><th>Satuan</th></tr></thead>
        <tbody>{lines.map((line, i) => {
          const item = Array.isArray(line.items) ? line.items[0] : line.items;
          return <tr key={line.id}>
          <td>{i + 1}</td><td>{item?.code}</td><td>{item?.name}</td>
          <td className={styles.quantity}>{formatQuantity(line.selected_qty ?? line.qty)}
            {line.selected_qty !== null && Number(line.faktor ?? 1) !== 1 && <small>Setara {formatQuantity(line.qty)} {item?.unit}</small>}
          </td>
          <td>{line.selected_qty === null ? item?.unit : line.satuan ?? item?.unit}</td>
        </tr>; })}</tbody>
      </table>
      {doc.keterangan && <p className={styles.notes}><strong>Keterangan:</strong> {doc.keterangan}</p>}
      <div className={styles.signatures}>
        {["Diserahkan oleh", "Dibawa oleh", "Diterima oleh"].map(label => <div key={label}><p>{label}</p><div /><p>Nama / tanda tangan / tanggal</p></div>)}
      </div>
      <p className={styles.disclaimer}>Pencetakan tidak mengubah stok atau status penerimaan di sistem.</p>
    </article>)}
  </>;
}
