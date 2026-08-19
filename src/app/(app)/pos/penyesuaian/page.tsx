import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { ALASAN_WARNA } from "./alasan";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

type Row = {
  id: string; no_adj: string; tanggal: string; alasan: string; keterangan: string | null;
  nilai_masuk: number; nilai_keluar: number;
  warehouses: Rel<{ name: string }>;
  inventory_adjustment_items: { id: string }[] | null;
};

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function PenyesuaianPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("inventory_adjustments")
    .select("id, no_adj, tanggal, alasan, keterangan, nilai_masuk, nilai_keluar, warehouses(name), inventory_adjustment_items(id)")
    .order("tanggal", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

  const totalKeluar = rows.reduce((a, r) => a + Number(r.nilai_keluar), 0);
  const totalMasuk = rows.reduce((a, r) => a + Number(r.nilai_masuk), 0);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
          <span style={{ color: "var(--td)" }}>·</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Penyesuaian Persediaan</span>
        </div>
        <Link href="/pos/penyesuaian/baru" className="btn-acc" style={{ fontSize: 11.5, textDecoration: "none" }}>
          <i className="ti ti-plus" /> Penyesuaian baru
        </Link>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> {success}
        </div>
      )}

      <div className="crm-sec">
        <SecHeader
          num="01"
          title="DAFTAR PENYESUAIAN"
          desc={`Koreksi stok bernomor dengan alasan wajib. 100 dokumen terakhir · barang berkurang ${rp(totalKeluar)}, bertambah ${rp(totalMasuk)}.`}
        />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Nomor #</th><th>Tanggal</th><th>Gudang</th><th>Alasan</th>
                <th style={{ textAlign: "center" }}>Barang</th>
                <th style={{ textAlign: "right" }}>Berkurang</th>
                <th style={{ textAlign: "right" }}>Bertambah</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/pos/penyesuaian/${r.id}`} style={{ fontWeight: 700, fontSize: 11.5, color: "#2563eb" }}>
                      {r.no_adj}
                    </Link>
                    {r.keterangan && <div style={{ fontSize: 10, color: "var(--tm)" }}>{r.keterangan}</div>}
                  </td>
                  <td style={{ fontSize: 11.5 }}>{fmtD(r.tanggal)}</td>
                  <td style={{ fontSize: 11.5 }}>{one(r.warehouses)?.name ?? "—"}</td>
                  <td>
                    <span className="bge" style={{
                      background: `color-mix(in srgb, ${ALASAN_WARNA[r.alasan] ?? "#4b5563"} 12%, transparent)`,
                      color: ALASAN_WARNA[r.alasan] ?? "#4b5563", textTransform: "capitalize",
                    }}>{r.alasan}</span>
                  </td>
                  <td style={{ textAlign: "center", fontSize: 11.5 }}>{r.inventory_adjustment_items?.length ?? 0}</td>
                  <td style={{ textAlign: "right", fontSize: 11.5, color: Number(r.nilai_keluar) ? "#b91c1c" : "var(--td)" }}>
                    {Number(r.nilai_keluar) ? rp(Number(r.nilai_keluar)) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, color: Number(r.nilai_masuk) ? "#15803d" : "var(--td)" }}>
                    {Number(r.nilai_masuk) ? rp(Number(r.nilai_masuk)) : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "22px 0", fontSize: 11.5 }}>
                  Belum ada penyesuaian. Koreksi stok sekarang lewat dokumen ini supaya ada jejaknya.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
