// Faktur penjualan grosir siap kirim ke pelanggan (Cetak / Simpan PDF lewat dialog
// cetak browser, sama seperti invoice klinik). Sengaja TIDAK menampilkan HPP,
// jurnal, koreksi, atau catatan internal — hanya yang pantas dilihat pelanggan.
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/PrintButton";
import { printBranchHeading } from "@/components/print-branch-heading";
import { subtotalBaris } from "@/lib/faktur-jual-edit";
import { sisaPiutangGrosir } from "@/lib/retur-grosir";
import { readCompleteList } from "@/lib/checked-list";

const rp = (n: number | string | null | undefined) =>
  `Rp ${Number(n ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const tanggalPanjang = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric" }) : "-";
const one = <T,>(r: T | T[] | null | undefined): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));

type Baris = { id: string; nama: string; qty: number; harga: number; diskon: number | null; satuan: string | null };

export default async function CetakFakturPenjualanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await createClient();
  const { data: invoice, error } = await db.from("sales_invoices")
    .select("id,no_faktur,tanggal,jatuh_tempo,total,dpp,ppn,carried_paid,returned_ar,status,customers(name,phone,address,npwp),branches(name,code)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Faktur belum dapat dibaca. Muat ulang sebelum mencetak.");
  if (!invoice) notFound();

  const [items, receipts, company] = await Promise.all([
    readCompleteList<Baris>((from, to) => db.from("sales_invoice_items")
      .select("id,nama,qty,harga,diskon,satuan", { count: "exact" })
      .eq("invoice_id", id).order("id").range(from, to), "Barang faktur", { maxRows: null }),
    readCompleteList<{ id: string; jumlah: number }>((from, to) => db.from("sales_receipts")
      .select("id,jumlah", { count: "exact" })
      .eq("invoice_id", id).order("id").range(from, to), "Penerimaan faktur", { maxRows: null }),
    db.from("company_settings").select("nama_perusahaan,alamat,npwp").eq("id", true).maybeSingle(),
  ]);
  if (company.error) throw new Error("Identitas perusahaan belum dapat dibaca. Muat ulang sebelum mencetak.");

  const customer = one(invoice.customers);
  const branch = one(invoice.branches);
  const perusahaan = company.data;
  // Dihitung persis seperti halaman detail faktur supaya angka di kertas = angka di layar.
  const dibayar = Number(invoice.carried_paid) + receipts.reduce((s, r) => s + Number(r.jumlah), 0);
  const retur = Number(invoice.returned_ar ?? 0);
  const sisa = sisaPiutangGrosir(invoice, receipts.reduce((s, r) => s + Number(r.jumlah), 0));
  const bruto = items.reduce((s, b) => s + Number(b.qty) * Number(b.harga), 0);
  const diskon = items.reduce((s, b) => s + Number(b.diskon ?? 0), 0);
  const batal = invoice.status === "batal";
  const lunas = !batal && sisa <= 0.005;

  return <>
    <style>{`@media print { @page { size: A4; margin: 14mm; } .faktur-doc { border: none !important; padding: 0 !important; max-width: 100% !important; } }`}</style>
    <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
      <Link href={`/penjualan/faktur/${id}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke faktur</Link>
      <PrintButton label="Cetak / Simpan PDF" />
    </div>
    <p className="no-print" style={{ fontSize: 11.5, color: "var(--tm)", margin: "0 0 12px" }}>
      Untuk simpan sebagai PDF: klik tombol di atas, lalu pilih tujuan <b>Simpan sebagai PDF</b> / <b>Save as PDF</b>.
    </p>

    <div className="faktur-doc" style={{ maxWidth: 760, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10, padding: "32px 36px", fontSize: 12.5, color: "#141413" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, borderBottom: "2px solid #16213e", paddingBottom: 14, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900 }}>{perusahaan?.nama_perusahaan?.trim() || printBranchHeading(branch)}</div>
          {perusahaan?.nama_perusahaan?.trim() && <div style={{ fontSize: 11.5, fontWeight: 600 }}>{printBranchHeading(branch)}</div>}
          {perusahaan?.alamat && <div style={{ fontSize: 11, color: "var(--tm)", maxWidth: 360 }}>{perusahaan.alamat}</div>}
          {perusahaan?.npwp && <div style={{ fontSize: 11, color: "var(--tm)" }}>NPWP {perusahaan.npwp}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: ".04em" }}>FAKTUR PENJUALAN</div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 3 }}>{invoice.no_faktur}</div>
          <span style={{ display: "inline-block", marginTop: 6, padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
            background: batal ? "#f3f4f6" : lunas ? "#e8f5ee" : "#fef2f2", color: batal ? "#4b5563" : lunas ? "#15803d" : "#b91c1c" }}>
            {batal ? "DIBATALKAN" : lunas ? "LUNAS" : "BELUM LUNAS"}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 9.5, color: "var(--td)", letterSpacing: ".06em", marginBottom: 3 }}>KEPADA</div>
          <div style={{ fontWeight: 600 }}>{customer?.name ?? "Tanpa pelanggan"}</div>
          {customer?.address && <div style={{ fontSize: 11, color: "var(--tm)", maxWidth: 320 }}>{customer.address}</div>}
          {customer?.phone && <div style={{ fontSize: 11, color: "var(--tm)" }}>{customer.phone}</div>}
          {customer?.npwp && <div style={{ fontSize: 11, color: "var(--tm)" }}>NPWP {customer.npwp}</div>}
        </div>
        <table style={{ fontSize: 11.5, borderCollapse: "collapse" }}><tbody>
          <tr><td style={{ color: "var(--tm)", paddingRight: 12 }}>Tanggal faktur</td><td style={{ textAlign: "right" }}>{tanggalPanjang(invoice.tanggal)}</td></tr>
          <tr><td style={{ color: "var(--tm)", paddingRight: 12 }}>Jatuh tempo</td><td style={{ textAlign: "right", fontWeight: 600 }}>{tanggalPanjang(invoice.jatuh_tempo)}</td></tr>
        </tbody></table>
      </div>

      <table className="tbl" style={{ width: "100%" }}>
        <thead><tr>
          <th style={{ width: 28 }}>No</th><th>Barang</th>
          <th style={{ textAlign: "right", width: 80 }}>Qty</th>
          <th style={{ textAlign: "right", width: 110 }}>Harga</th>
          <th style={{ textAlign: "right", width: 90 }}>Diskon</th>
          <th style={{ textAlign: "right", width: 120 }}>Jumlah</th>
        </tr></thead>
        <tbody>
          {items.map((b, i) => <tr key={b.id}>
            <td style={{ color: "var(--td)" }}>{i + 1}</td>
            <td style={{ fontWeight: 500 }}>{b.nama}</td>
            <td style={{ textAlign: "right" }}>{Number(b.qty).toLocaleString("id-ID")} {b.satuan ?? ""}</td>
            <td style={{ textAlign: "right" }}>{rp(b.harga)}</td>
            <td style={{ textAlign: "right" }}>{Number(b.diskon ?? 0) > 0 ? rp(b.diskon) : "—"}</td>
            <td style={{ textAlign: "right" }}>{rp(subtotalBaris({ qty: Number(b.qty), harga: Number(b.harga), diskon: Number(b.diskon ?? 0) }))}</td>
          </tr>)}
          {items.length === 0 && <tr><td colSpan={6} style={{ color: "var(--tm)" }}>Faktur ini tidak memuat rincian barang.</td></tr>}
        </tbody>
      </table>

      <div style={{ marginTop: 14, marginLeft: "auto", width: 280 }}>
        {diskon > 0.005 && <>
          <SumRow label="Total harga barang" value={rp(bruto)} />
          <SumRow label="Diskon" value={`- ${rp(diskon)}`} />
        </>}
        {Number(invoice.ppn) > 0 && <>
          <SumRow label="DPP" value={rp(invoice.dpp)} />
          <SumRow label="PPN" value={rp(invoice.ppn)} />
        </>}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1.5px solid #141413", marginTop: 4 }}>
          <span style={{ fontWeight: 700 }}>TOTAL</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{rp(invoice.total)}</span>
        </div>
        {!batal && dibayar > 0.005 && <SumRow label="Sudah dibayar" value={`- ${rp(dibayar)}`} />}
        {!batal && retur > 0.005 && <SumRow label="Retur barang" value={`- ${rp(retur)}`} />}
        {!batal && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
          <span style={{ fontWeight: 600, color: lunas ? "#15803d" : "#b91c1c" }}>Sisa tagihan</span>
          <span style={{ fontWeight: 700, color: lunas ? "#15803d" : "#b91c1c" }}>{rp(sisa)}</span>
        </div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40, fontSize: 11.5 }}>
        <div style={{ textAlign: "center", width: 180 }}>
          <div style={{ color: "var(--tm)" }}>Penerima</div>
          <div style={{ borderBottom: ".5px solid #141413", height: 56 }} />
        </div>
        <div style={{ textAlign: "center", width: 180 }}>
          <div style={{ color: "var(--tm)" }}>Hormat kami</div>
          <div style={{ borderBottom: ".5px solid #141413", height: 56 }} />
        </div>
      </div>
    </div>
  </>;
}

function SumRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}><span style={{ color: "var(--tm)" }}>{label}</span><span>{value}</span></div>;
}
