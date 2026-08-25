import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../PrintButton";
import { bacaRombongan } from "@/lib/rombongan-server";
import { labelStatus, ringkasTagihanRombongan } from "@/lib/rombongan-tagihan";

// Struk gabungan satu kedatangan: pemilik menerima SATU lembar untuk seluruh
// hewannya. Di belakang layar tagihannya tetap terpisah per kunjungan — nomor
// tagihan masing-masing tetap dicetak supaya tiap baris bisa ditelusuri ke
// rekam medis, insentif dokter, dan jurnalnya sendiri.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function StrukRombonganPage({ params }: { params: Promise<{ visitId: string }> }) {
  const { visitId } = await params;
  const supabase = await createClient();

  const rombongan = await bacaRombongan(supabase, visitId);
  if (!rombongan) notFound();

  const ringkasan = ringkasTagihanRombongan(rombongan.baris);

  const { data: acuan } = await supabase
    .from("visits").select("branches(name)").eq("id", visitId).maybeSingle();
  const branch = one(acuan?.branches as Rel<{ name: string }>);

  // Rincian tiap tagihan. Kunjungan yang belum ditagih sengaja tetap tampil sebagai
  // baris kosong — pemilik berhak tahu ada pemeriksaan yang tagihannya belum keluar.
  const invoiceIds = rombongan.baris.map((b) => b.invoiceNo).filter(Boolean) as string[];
  const { data: invs } = invoiceIds.length
    ? await supabase
        .from("invoices")
        .select("id, invoice_no, subtotal, discount, tax, total, metode_bayar, paid_status, dp_amount")
        .in("invoice_no", invoiceIds)
    : { data: [] as Record<string, unknown>[] };

  type Inv = {
    id: string; invoice_no: string; subtotal: number; discount: number; tax: number;
    total: number; metode_bayar: string | null; paid_status: string; dp_amount: number;
  };
  const invRows = (invs ?? []) as unknown as Inv[];

  const { data: allItems } = invRows.length
    ? await supabase.from("invoice_items").select("invoice_id, deskripsi, qty, harga")
        .in("invoice_id", invRows.map((i) => i.id)).order("created_at")
    : { data: [] as { invoice_id: string; deskripsi: string; qty: number; harga: number }[] };

  const itemsPerInv = new Map<string, { deskripsi: string; qty: number; harga: number }[]>();
  for (const it of (allItems ?? []) as { invoice_id: string; deskripsi: string; qty: number; harga: number }[]) {
    itemsPerInv.set(it.invoice_id, [...(itemsPerInv.get(it.invoice_id) ?? []), it]);
  }
  const invPerNo = new Map(invRows.map((i) => [i.invoice_no, i]));

  const totalDiskon = invRows.reduce((a, i) => a + (Number(i.discount) || 0), 0);
  const totalPpn = invRows.reduce((a, i) => a + (Number(i.tax) || 0), 0);
  const metode = [...new Set(invRows.map((i) => i.metode_bayar).filter(Boolean))].join(", ") || "-";
  const tgl = new Date(`${rombongan.tanggal}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta",
    day: "2-digit", month: "short", year: "numeric",
  });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/pembayaran/${visitId}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Struk Gabungan" />
      </div>

      {!ringkasan.semuaLunas && (
        <div className="no-print p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e" }}>
          <i className="ti ti-alert-triangle" /> Masih ada tagihan yang belum lunas — struk ini belum bisa dipakai sebagai bukti pelunasan.
        </div>
      )}

      <div style={{ width: "74mm", margin: "0 auto", background: "#fff", padding: "10px 8px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "#000", lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: ".05em" }}>KAMO PET CARE</div>
          <div style={{ fontSize: 9.5 }}>{branch?.name ?? "Klinik Hewan"}</div>
        </div>
        <Hr />
        <Kv k="Tgl" v={tgl} />
        <Kv k="Pemilik" v={rombongan.customerName} />
        <Kv k="Pasien" v={`${ringkasan.jumlahPasien} ekor`} />
        <Hr />

        {rombongan.baris.map((b) => {
          const inv = b.invoiceNo ? invPerNo.get(b.invoiceNo) : null;
          return (
            <div key={b.visitId} style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>
                {b.hewan}
                {inv ? <span style={{ fontWeight: 400, fontSize: 9.5 }}> · {inv.invoice_no}</span> : null}
              </div>
              {!inv && <div style={{ fontSize: 9.5 }}>(tagihan belum dibuat)</div>}
              {(inv ? itemsPerInv.get(inv.id) ?? [] : []).map((it, i) => (
                <div key={i}>
                  <div>{it.deskripsi}</div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{it.qty} x {rp(it.harga)}</span>
                    <span>{rp(it.qty * it.harga)}</span>
                  </div>
                </div>
              ))}
              {inv && (
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
                  <span>Subtotal {b.hewan}</span><span>{rp(inv.total)}</span>
                </div>
              )}
            </div>
          );
        })}

        <Hr />
        {totalDiskon > 0 && <Row k="Diskon" v={`-${rp(totalDiskon)}`} />}
        {totalPpn > 0 && <Row k="PPN" v={rp(totalPpn)} />}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 12, marginTop: 2 }}>
          <span>TOTAL SEMUA</span><span>{rp(ringkasan.totalTagihan)}</span>
        </div>
        <Row k="Dibayar" v={rp(ringkasan.totalDibayar)} />
        {ringkasan.sisa > 0 && <Row k="Sisa" v={rp(ringkasan.sisa)} />}
        <Hr />
        <Row k="Metode" v={metode} />
        <Row k="Status" v={ringkasan.semuaLunas ? "Lunas" : "Belum lunas"} />
        <Hr />
        <div style={{ fontSize: 9 }}>
          {rombongan.baris.map((b) => (
            <div key={b.visitId} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{b.hewan}</span><span>{labelStatus(b)}</span>
            </div>
          ))}
        </div>
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
