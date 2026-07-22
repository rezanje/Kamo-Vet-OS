import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

type Row = {
  id: string;
  no_retur: string;
  tanggal: string;
  keterangan: string | null;
  total: number;
  sales: { no_struk: string | null; customers: { name: string } | null } | null;
  sales_return_items: { id: string }[] | null;
};

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function ReturJualPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales_returns")
    .select("id, no_retur, tanggal, keterangan, total, sales(no_struk, customers(name)), sales_return_items(id)")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Retur Penjualan</span>
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
          title="RETUR PENJUALAN"
          desc="Barang kembali dari pelanggan, refund tunai lewat kasir (pola Accurate)."
          action={
            <Link href="/penjualan/retur/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Buat retur
            </Link>
          }
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>Tanggal</th>
                <th>Struk</th>
                <th>Pelanggan</th>
                <th style={{ textAlign: "center" }}>Item</th>
                <th>Keterangan</th>
                <th style={{ textAlign: "right" }}>Total Refund</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500, fontSize: 11.5 }}>{r.no_retur}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.tanggal)}</td>
                  <td style={{ fontSize: 11.5 }}>{r.sales?.no_struk ?? "—"}</td>
                  <td style={{ fontSize: 11.5 }}>{r.sales?.customers?.name ?? "Umum"}</td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{r.sales_return_items?.length ?? 0}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.keterangan ?? ""}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(r.total))}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada retur penjualan.
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
