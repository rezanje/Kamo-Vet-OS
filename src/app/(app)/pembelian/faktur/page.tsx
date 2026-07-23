import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

type Row = {
  id: string;
  no_faktur: string;
  no_faktur_pemasok: string | null;
  tanggal: string;
  jatuh_tempo: string;
  total: number;
  suppliers: { nama: string } | null;
  purchase_orders: { no_po: string | null } | null;
  purchase_invoice_payments: { amount: number }[] | null;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function FakturBeliPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("purchase_invoices")
    .select("id, no_faktur, no_faktur_pemasok, tanggal, jatuh_tempo, total, suppliers(nama), purchase_orders(no_po), purchase_invoice_payments(amount)")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pembelian" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Faktur Pembelian</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="FAKTUR PEMBELIAN"
          desc="Tagihan resmi pemasok — hutang usaha lahir dari sini, dibayar per faktur (pola Accurate)."
          action={
            <Link href="/pembelian/faktur/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Buat faktur
            </Link>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 880 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>No. Faktur Pemasok</th>
                <th>Tanggal</th>
                <th>Jatuh Tempo</th>
                <th>Pemasok</th>
                <th>PO</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th style={{ textAlign: "right" }}>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const dibayar = (r.purchase_invoice_payments ?? []).reduce((a, p) => a + Number(p.amount), 0);
                const sisa = Math.max(0, Number(r.total) - dibayar);
                const telat = sisa > 0 && r.jatuh_tempo < today;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_faktur}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.no_faktur_pemasok ?? "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.tanggal)}</td>
                    <td style={{ fontSize: 11, color: telat ? "#b91c1c" : "var(--tm)", fontWeight: telat ? 700 : 400 }}>
                      {fmtD(r.jatuh_tempo)}{telat ? " !" : ""}
                    </td>
                    <td style={{ fontSize: 11.5 }}>{r.suppliers?.nama ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{r.purchase_orders?.no_po ?? "—"}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5 }}>{rp(Number(r.total))}</td>
                    <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600, color: sisa > 0 ? "#b91c1c" : "#15803d" }}>
                      {sisa > 0 ? rp(sisa) : "Lunas"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada faktur pembelian.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
