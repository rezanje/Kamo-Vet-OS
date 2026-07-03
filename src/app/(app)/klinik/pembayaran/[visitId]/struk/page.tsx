import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../PrintButton";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function StrukPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const { data: visit } = await supabase
    .from("visits")
    .select("id, poli, dokter, pets(name, species), customers(name), branches(name, code)")
    .eq("id", visitId).maybeSingle();
  if (!visit) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, invoice_no, subtotal, discount, tax, total, dp_amount, paid_status, metode_bayar, paid_at, created_at")
    .eq("visit_id", visitId).is("voided_at", null).maybeSingle();
  if (!invoice) notFound();

  const { data: items } = await supabase
    .from("invoice_items").select("deskripsi, qty, harga").eq("invoice_id", invoice.id).order("created_at");

  const pet = one(visit.pets);
  const cust = one(visit.customers);
  const branch = one(visit.branches);
  const tgl = new Date(invoice.paid_at ?? invoice.created_at).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/pembayaran/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Struk" />
      </div>

      {/* Struk thermal 80mm */}
      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>KAMO PET CARE</div>
          <div style={{ fontSize: 9.5 }}>{branch?.name ?? "Klinik Hewan"}</div>
        </div>
        <Hr />
        <Kv k="No" v={invoice.invoice_no ?? "-"} />
        <Kv k="Tgl" v={tgl} />
        <Kv k="Kasir" v={visit.dokter ?? "-"} />
        <Kv k="Pasien" v={`${pet?.name ?? "-"} (${pet?.species ?? "-"})`} />
        <Kv k="Pemilik" v={cust?.name ?? "-"} />
        <Hr />
        {(items ?? []).map((it, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{it.deskripsi}</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{it.qty} x {rp(it.harga)}</span>
              <span>{rp(it.qty * it.harga)}</span>
            </div>
          </div>
        ))}
        <Hr />
        <Row k="Subtotal" v={rp(invoice.subtotal)} />
        {invoice.discount > 0 && <Row k="Diskon" v={`-${rp(invoice.discount)}`} />}
        <Row k="PPN 11%" v={rp(invoice.tax)} />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}>
          <span>TOTAL</span><span>{rp(invoice.total)}</span>
        </div>
        <Hr />
        <Row k="Metode" v={invoice.metode_bayar ?? "-"} />
        <Row k="Status" v={invoice.paid_status} />
        {invoice.paid_status === "DP" && <Row k="Sisa" v={rp(invoice.total - invoice.dp_amount)} />}
        <Hr />
        <div style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>
          Terima kasih 🐾<br />Semoga anabul sehat selalu
        </div>
      </div>
    </>
  );
}

function Hr() {
  return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />;
}
function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ minWidth: 48 }}>{k}</span><span>: {v}</span>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span>{v}</span></div>;
}
