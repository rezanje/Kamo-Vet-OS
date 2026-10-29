import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { DocumentLink } from "@/components/RelatedDocuments";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
type Row = {
  id: string; no_retur: string; tanggal: string; total: number; ar_reduction: number; customer_credit: number; status: string;
  customers: Rel<{ name: string }>; sales_invoices: Rel<{ id: string; no_faktur: string }>;
};
const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

export default async function ReturGrosirPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const db = await createClient();
  const { data, error: readError } = await db.from("wholesale_returns")
    .select("id,no_retur,tanggal,total,ar_reduction,customer_credit,status,customers(name),sales_invoices!invoice_id(id,no_faktur)")
    .order("tanggal", { ascending: false }).order("no_retur", { ascending: false }).limit(200);
  if (readError) throw new Error("Daftar retur faktur belum dapat dibaca: " + readError.message);
  const rows = (data ?? []) as unknown as Row[];
  return <>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
      <Link href="/penjualan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
      <span style={{ color: "var(--td)" }}>·</span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>Retur Faktur Penjualan</span>
    </div>
    {error && <div className="p2ban" role="alert">{error}</div>}
    <div className="crm-sec">
      <SecHeader num="01" title="RETUR FAKTUR PENJUALAN (GROSIR)"
        desc="Barang kembali dari pelanggan grosir atas faktur tertentu. Buat retur dari halaman faktur: Aksi → Retur barang." />
      <div style={{ overflowX: "auto" }}><table className="tbl" style={{ minWidth: 760 }}><thead><tr>
        <th>Nomor #</th><th>Tanggal</th><th>Faktur</th><th>Pelanggan</th><th style={{ textAlign: "right" }}>Nilai retur</th>
        <th style={{ textAlign: "right" }}>Kurangi piutang</th><th style={{ textAlign: "right" }}>Kredit pelanggan</th><th>Status</th>
      </tr></thead><tbody>
        {rows.map((r) => { const f = one(r.sales_invoices); return <tr key={r.id}>
          <td><DocumentLink kind="sales-return-wholesale" id={r.id}>{r.no_retur}</DocumentLink></td>
          <td>{r.tanggal}</td>
          <td>{f ? <DocumentLink kind="sales-invoice" id={f.id}>{f.no_faktur}</DocumentLink> : "—"}</td>
          <td>{one(r.customers)?.name ?? "—"}</td>
          <td style={{ textAlign: "right" }}>{rp(r.total)}</td>
          <td style={{ textAlign: "right" }}>{rp(r.ar_reduction)}</td>
          <td style={{ textAlign: "right" }}>{rp(r.customer_credit)}</td>
          <td>{r.status === "batal" ? "Dibatalkan" : "Terposting"}</td>
        </tr>; })}
        {rows.length === 0 && <tr><td colSpan={8}>Belum ada retur faktur penjualan.</td></tr>}
      </tbody></table></div>
      {rows.length === 200 && <p style={{ fontSize: 11 }}>Menampilkan 200 retur terbaru.</p>}
    </div>
  </>;
}
