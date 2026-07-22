import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";

type Row = {
  id: string;
  no_opname: string;
  tanggal_mulai: string;
  penanggung_jawab: string;
  keterangan: string | null;
  status: string;
  warehouses: { name: string } | null;
  opname_results: { no_hasil: string }[] | null;
};

const fmtD = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export default async function OpnamePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; status?: string }>;
}) {
  const { success, error, status } = await searchParams;
  const supabase = await createClient();

  let q = supabase
    .from("opname_orders")
    .select("id, no_opname, tanggal_mulai, penanggung_jawab, keterangan, status, warehouses(name), opname_results(no_hasil)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Stok Opname</span>
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
          title="PERINTAH STOK OPNAME"
          desc="Surat tugas hitung fisik per gudang → input hasil → stok & jurnal menyesuaikan (pola Accurate)."
          action={
            <Link href="/pos/opname/baru" className="btn-acc" style={{ textDecoration: "none" }}>
              + Perintah opname
            </Link>
          }
        />

        <form method="get" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <select className="fi" name="status" defaultValue={status ?? ""} style={{ width: 160 }}>
            <option value="">Status: Semua</option>
            <option value="Terbuka">Terbuka</option>
            <option value="Selesai">Selesai</option>
          </select>
          <button type="submit" className="btn-def" style={{ padding: "4px 12px", fontSize: 10.5 }}>
            <i className="ti ti-filter" /> Filter
          </button>
        </form>

        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Nomor #</th>
                <th>Tanggal Mulai</th>
                <th>Gudang</th>
                <th>Penanggung Jawab</th>
                <th>Keterangan</th>
                <th>Hasil</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500, fontSize: 11.5 }}>
                    <Link href={`/pos/opname/${r.id}`} style={{ color: "var(--ac)" }}>{r.no_opname}</Link>
                  </td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtD(r.tanggal_mulai)}</td>
                  <td style={{ fontSize: 11.5 }}>{r.warehouses?.name ?? "—"}</td>
                  <td style={{ fontSize: 11.5 }}>{r.penanggung_jawab}</td>
                  <td style={{ fontSize: 11, color: "var(--tm)" }}>{r.keterangan ?? ""}</td>
                  <td style={{ fontSize: 11.5 }}>{r.opname_results?.[0]?.no_hasil ?? "—"}</td>
                  <td>
                    <span className={`bge ${r.status === "Selesai" ? "g" : "o"}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada perintah stok opname.
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
