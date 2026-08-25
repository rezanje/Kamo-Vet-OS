import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const tgl = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

type Kirim = {
  id: string; no_kirim: string; tanggal: string; ekspedisi: string | null; no_resi: string | null;
  sales_orders: Rel<{ id: string; no_pesanan: string; customers: Rel<{ name: string }> }>;
  sales_delivery_items: { qty: number; hpp: number | null }[] | null;
};

export default async function PengirimanPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("sales_deliveries")
    .select("id, no_kirim, tanggal, ekspedisi, no_resi, sales_orders(id, no_pesanan, customers(name)), sales_delivery_items(qty, hpp)")
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const dok = (data ?? []) as unknown as Kirim[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/penjualan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Pengiriman Pesanan</span>
      </div>

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader
          num="01" title="SURAT JALAN"
          desc="Dibuat dari halaman pesanan. Di sinilah stok keluar dan modalnya diakui — pendapatannya menyusul di faktur."
        />

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 150 }}>No. pengiriman</th>
                <th style={{ width: 110 }}>Tanggal</th>
                <th>Pelanggan</th>
                <th style={{ width: 130 }}>Pesanan</th>
                <th style={{ width: 180 }}>Ekspedisi / resi</th>
                <th style={{ width: 90, textAlign: "right" }}>Unit</th>
                <th style={{ width: 130, textAlign: "right" }}>Modal keluar</th>
              </tr>
            </thead>
            <tbody>
              {dok.map((d) => {
                const so = one(d.sales_orders);
                const qty = (d.sales_delivery_items ?? []).reduce((a, x) => a + Number(x.qty), 0);
                const hpp = (d.sales_delivery_items ?? []).reduce((a, x) => a + Number(x.hpp ?? 0), 0);
                return (
                  <tr key={d.id}>
                    <td style={{ fontSize: 11.5, fontWeight: 600 }}>{d.no_kirim}</td>
                    <td style={{ fontSize: 11 }}>{tgl(d.tanggal)}</td>
                    <td style={{ fontSize: 11.5 }}>{one(so?.customers ?? null)?.name ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>
                      {so ? (
                        <Link href={`/penjualan/pesanan/${so.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                          {so.no_pesanan}
                        </Link>
                      ) : "—"}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {d.ekspedisi ?? "—"}{d.no_resi ? ` · ${d.no_resi}` : ""}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{qty}</td>
                    <td style={{ textAlign: "right", fontSize: 11 }}>{rp(hpp)}</td>
                  </tr>
                );
              })}
              {dok.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>
                  Belum ada pengiriman. Buat dari halaman pesanan penjualan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
