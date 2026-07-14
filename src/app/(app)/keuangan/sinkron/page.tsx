import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { findDrift, perbaikiDrift } from "./actions";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtDate = (s: string) => (s ? new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export default async function SinkronPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const { success } = await searchParams;
  const supabase = await createClient();
  const { invoices, sales } = await findDrift(supabase);
  const totalDrift = invoices.length + sales.length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Sinkronisasi Jurnal</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success} jurnal berhasil diposting ulang — buku besar sinkron kembali.
        </div>
      )}

      <div className="p2ban" style={{ background: totalDrift === 0 ? "#e8f5ee" : "#fffbeb", border: `.5px solid ${totalDrift === 0 ? "#86efac" : "#fcd34d"}`, color: totalDrift === 0 ? "#15803d" : "#b45309" }}>
        <i className={`ti ti-${totalDrift === 0 ? "circle-check" : "alert-triangle"}`} />{" "}
        {totalDrift === 0
          ? "Semua transaksi sudah terjurnal — buku besar sinkron dengan operasional."
          : `${totalDrift} transaksi belum punya jurnal (${invoices.length} invoice klinik, ${sales.length} penjualan POS).`}
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="TRANSAKSI TANPA JURNAL" desc="Transaksi operasional yang tidak tercatat di buku besar — laporan keuangan meleset selama ini belum diperbaiki."
          action={totalDrift > 0 ? (
            <form action={perbaikiDrift}>
              <button type="submit" className="pay-btn" style={{ padding: "7px 14px", fontSize: 11 }}>
                <i className="ti ti-refresh" /> Posting Ulang Semua
              </button>
            </form>
          ) : undefined} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr><th>Jenis</th><th>Referensi</th><th>Tanggal</th><th style={{ textAlign: "right" }}>Nilai</th></tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.invoice_no}>
                  <td><span className="bge o">Invoice Klinik</span></td>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{i.invoice_no}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(i.tanggal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(i.total)}</td>
                </tr>
              ))}
              {sales.map((s) => (
                <tr key={s.no_struk}>
                  <td><span className="bge b">Penjualan POS</span></td>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5 }}>{s.no_struk}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtDate(s.tanggal)}</td>
                  <td style={{ textAlign: "right", fontSize: 11 }}>{rp(s.total)}</td>
                </tr>
              ))}
              {totalDrift === 0 && (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Tidak ada — semuanya sudah terjurnal. ✓</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
