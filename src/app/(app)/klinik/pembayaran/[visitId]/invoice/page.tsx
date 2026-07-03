import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../PrintButton";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function InvoicePage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, poli, dokter, created_at, pets(name, species, breed), customers(name, phone, address), branches(name, code)")
    .eq("id", visitId).maybeSingle();
  if (!visit) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, dp_date, paid_status, metode_bayar, paid_at, created_at")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();
  if (!invoice) notFound();

  const { data: items } = await supabase
    .from("invoice_items").select("deskripsi, qty, harga").eq("invoice_id", invoice.id).order("created_at");

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const branch = one(visit.branches);
  const tgl = new Date(invoice.created_at).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const lunas = invoice.paid_status === "Lunas";
  const sisa = invoice.paid_status === "DP" ? invoice.total - invoice.dp_amount : lunas ? 0 : invoice.total;

  return (
    <>
      <style>{`@media print { @page { size: A4; margin: 14mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/pembayaran/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Invoice" />
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10, padding: "32px 36px", fontSize: 12.5, color: "#141413" }}>
        {/* Kop */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #16213e", paddingBottom: 14, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>KAMO<i className="ti ti-paw" style={{ fontSize: 16, verticalAlign: -1 }} /> PET CARE</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 3 }}>{branch?.name ?? "Klinik Hewan"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: ".04em" }}>INVOICE</div>
            <div style={{ fontSize: 12, color: "var(--tm)", marginTop: 3 }}>{invoice.invoice_no ?? "-"}</div>
            <div style={{ fontSize: 10.5, color: "var(--tm)" }}>{tgl}</div>
            <span style={{ display: "inline-block", marginTop: 6, padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
              background: lunas ? "#e8f5ee" : "#fef2f2", color: lunas ? "#15803d" : "#b91c1c" }}>{invoice.paid_status}</span>
          </div>
        </div>

        {/* Tagih ke */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 9.5, color: "var(--td)", letterSpacing: ".06em", marginBottom: 3 }}>TAGIHAN KEPADA</div>
            <div style={{ fontWeight: 600 }}>{cust?.name ?? "-"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)" }}>{cust?.phone ?? ""}</div>
            <div style={{ fontSize: 11, color: "var(--tm)" }}>{cust?.address ?? ""}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, color: "var(--tm)" }}>
            <div>Pasien: <b style={{ color: "#141413" }}>{pet?.name ?? "-"}</b> ({pet?.species ?? "-"}{pet?.breed ? " / " + pet.breed : ""})</div>
            <div>Poli: {visit.poli}</div>
            <div>Dokter: {visit.dokter ?? "-"}</div>
          </div>
        </div>

        {/* Items */}
        <table className="tbl" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>No</th><th>Deskripsi</th>
              <th style={{ textAlign: "center", width: 50 }}>Qty</th>
              <th style={{ textAlign: "right", width: 110 }}>Harga</th>
              <th style={{ textAlign: "right", width: 120 }}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it, i) => (
              <tr key={i}>
                <td style={{ color: "var(--td)" }}>{i + 1}</td>
                <td style={{ fontWeight: 500 }}>{it.deskripsi}</td>
                <td style={{ textAlign: "center" }}>{it.qty}</td>
                <td style={{ textAlign: "right" }}>{rp(it.harga)}</td>
                <td style={{ textAlign: "right" }}>{rp(it.qty * it.harga)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary */}
        <div style={{ marginTop: 14, marginLeft: "auto", width: 260 }}>
          <SumRow label="Subtotal (DPP)" value={rp(invoice.subtotal)} />
          {invoice.discount > 0 && <SumRow label="Diskon" value={`- ${rp(invoice.discount)}`} />}
          <SumRow label="PPN 11%" value={rp(invoice.tax)} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1.5px solid #141413", marginTop: 4 }}>
            <span style={{ fontWeight: 700 }}>TOTAL</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{rp(invoice.total)}</span>
          </div>
          {invoice.paid_status === "DP" && (
            <>
              <SumRow label="DP dibayar" value={`- ${rp(invoice.dp_amount)}`} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span style={{ color: "#b91c1c", fontWeight: 600 }}>Sisa</span>
                <span style={{ color: "#b91c1c", fontWeight: 700 }}>{rp(sisa)}</span>
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 24, fontSize: 11, color: "var(--tm)", borderTop: ".5px solid var(--bd)", paddingTop: 12 }}>
          Metode pembayaran: <b style={{ color: "#141413" }}>{invoice.metode_bayar ?? "-"}</b>
          {invoice.paid_at && ` · Lunas pada ${new Date(invoice.paid_at).toLocaleDateString("id-ID")}`}
          <div style={{ marginTop: 4, fontSize: 9.5, color: "var(--td)" }}>Invoice ini sah tanpa tanda tangan & cap. PPN 11% dihitung dari DPP (subtotal − diskon).</div>
        </div>
      </div>
    </>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11.5 }}><span style={{ color: "var(--tm)" }}>{label}</span><span>{value}</span></div>;
}
