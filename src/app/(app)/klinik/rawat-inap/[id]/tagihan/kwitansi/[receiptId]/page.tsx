import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/(app)/klinik/pembayaran/[visitId]/PrintButton";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? r[0] ?? null : r);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/** Kwitansi satu kali terima uang rawat inap — format thermal yang sama dengan struk klinik. */
export default async function KwitansiPage({ params }: { params: Promise<{ id: string; receiptId: string }> }) {
  const { id, receiptId } = await params;
  const supabase = await createClient();

  const { data: receipt, error } = await supabase
    .from("clinic_payment_receipts")
    .select("id, no_kwitansi, tanggal, total, status, catatan, void_reason, created_at, visit_id, branch_id, profiles!clinic_payment_receipts_created_by_fkey(full_name), clinic_payment_receipt_parts(urutan, metode, amount), branches(name)")
    .eq("id", receiptId).maybeSingle();
  if (error) throw new Error("Kwitansi belum dapat diverifikasi. Muat ulang sebelum mencetak.");
  if (!receipt) notFound();

  const [{ data: visit }, { data: alokasi }] = await Promise.all([
    supabase.from("visits").select("id, pets(name, species), customers(name)").eq("id", receipt.visit_id).maybeSingle(),
    supabase.from("invoice_payments")
      // invoice_id DAN transferred_from sama-sama menunjuk invoices; tanpa `!nama_fk`
      // embed-nya gagal (PGRST201) dan rincian alokasinya hilang diam-diam.
      .select("id, amount, metode, invoices!invoice_payments_invoice_id_fkey(invoice_no)")
      .eq("receipt_id", receiptId).order("created_at"),
  ]);
  const pet = one(visit?.pets as Rel<{ name: string; species: string | null }>);
  const cust = one(visit?.customers as Rel<{ name: string }>);
  const branch = one(receipt.branches as Rel<{ name: string }>);
  const kasir = one(receipt.profiles as Rel<{ full_name: string | null }>);
  const bagian = ((receipt.clinic_payment_receipt_parts ?? []) as { urutan: number; metode: string; amount: number }[])
    .slice().sort((a, b) => a.urutan - b.urutan);
  const terpakai = ((alokasi ?? []) as { amount: number }[]).reduce((s, p) => s + Number(p.amount), 0);
  const uangMuka = Math.max(0, Number(receipt.total) - terpakai);
  const tgl = new Date(receipt.created_at as string).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/rawat-inap/${id}/tagihan`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Kwitansi" />
      </div>

      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>KAMO PET CARE</div>
          <div style={{ fontSize: 9.5 }}>{branch?.name ?? "Klinik Hewan"}</div>
          <div style={{ fontSize: 10, fontWeight: 700, marginTop: 3 }}>KWITANSI PEMBAYARAN</div>
        </div>
        <Hr />
        <Kv k="No" v={receipt.no_kwitansi as string} />
        <Kv k="Tgl" v={tgl} />
        <Kv k="Kasir" v={kasir?.full_name ?? "Kasir belum tercatat"} />
        <Kv k="Pasien" v={`${pet?.name ?? "-"} (${pet?.species ?? "-"})`} />
        <Kv k="Pemilik" v={cust?.name ?? "-"} />
        <Hr />
        {bagian.map((b) => <Row key={b.urutan} k={b.metode} v={rp(Number(b.amount))} />)}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}>
          <span>DITERIMA</span><span>{rp(Number(receipt.total))}</span>
        </div>
        <Hr />
        {((alokasi ?? []) as { id: string; amount: number; metode: string; invoices: Rel<{ invoice_no: string }> }[]).map((p) => (
          <Row key={p.id} k={one(p.invoices)?.invoice_no ?? "Tagihan"} v={rp(Number(p.amount))} />
        ))}
        {uangMuka > 0 && <Row k="Uang muka pemilik" v={rp(uangMuka)} />}
        {receipt.catatan && <div style={{ fontSize: 10 }}>Catatan: {receipt.catatan as string}</div>}
        {receipt.status !== "aktif" && (
          <div style={{ fontWeight: 700, color: "#000", marginTop: 4 }}>
            DIBATALKAN{receipt.void_reason ? ` — ${receipt.void_reason as string}` : ""}
          </div>
        )}
        <Hr />
        <div style={{ textAlign: "center", fontSize: 10, marginTop: 6 }}>
          Terima kasih 🐾<br />Simpan kwitansi ini sebagai bukti pembayaran
        </div>
      </div>
    </>
  );
}

function Hr() { return <div style={{ borderTop: "1px dashed #000", margin: "5px 0" }} />; }
function Kv({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", gap: 6 }}><span style={{ minWidth: 48 }}>{k}</span><span>: {v}</span></div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span>{k}</span><span>{v}</span></div>;
}
